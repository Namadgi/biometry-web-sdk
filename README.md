# Biometry Web SDK

The official JavaScript/TypeScript SDK for integrating [Biometry](https://biometrysolutions.com) identity verification services into web applications. Provides a simple, promise-based API for biometric enrollment, liveness detection, face matching, document authentication, and consent management.

> **Companion library:** For pre-built React UI components (camera capture, liveness screens, etc.), see [biometry-react-components](https://www.npmjs.com/package/biometry-react-components). Use it alongside this SDK for a faster integration.

## Features

- **Session management** — group related transactions under a single session ID
- **Consent management** — collect authorization and storage consent (required before biometric operations)
- **Face enrollment** — register a user's face from a photo or ID document
- **Voice enrollment** — register a user's voice for speaker verification
- **Video processing** — liveness detection, active speaker detection, face recognition, voice recognition, and visual speech recognition in one call
- **Face matching** — compare a reference image against a video to verify identity
- **Document authentication** — extract and validate data from ID documents (passports, ID cards, etc.)
- **Full TypeScript support** — ships with complete type definitions
- **Framework-agnostic** — works with React, Angular, Vue, vanilla JS, or any web framework

## Getting Started

### Prerequisites

- An active Biometry project with an **API key** (obtain one from the [Biometry Dashboard](https://console.biometrysolutions.com))
- Node.js 16+ (for npm-based projects) or any modern browser with ES module support

### Installation

```bash
npm install biometry-sdk
```

### Initialization

```typescript
import { BiometrySDK } from 'biometry-sdk';

const sdk = new BiometrySDK('YOUR_API_KEY');
```

The API key is used as a Bearer token for all requests to the Biometry API. An error is thrown if the key is empty.

> **Security:** Never hardcode API keys in client-side code shipped to production. Use environment variables or a server-side proxy to keep your key private.

## Response Structure

All gateway API responses follow a standard envelope format:

```text
{
  "data": { ... },
  "scoring_result": "pass" | "fail" | "refer" | { ... },
  "score": 0.95,
  "decision_reasons": ["reason1", "reason2"],
  "message": "human-readable status message"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data` | `object` | The primary response payload (service results, extracted data, etc.) |
| `scoring_result` | `string \| object` | Scoring outcome — `"pass"`, `"fail"`, or `"refer"` for video processing and document auth; a detailed scoring map for face matching |
| `score` | `number` | Numeric confidence score (0–1), present on video processing responses |
| `decision_reasons` | `string[]` | Reasons for a fail/refer decision (e.g. `["liveness_failed"]`) |
| `message` | `string` | Human-readable status message |

The SDK wraps this in an `ApiResponse<T>` object that also includes the HTTP response headers:

```typescript
interface ApiResponse<T> {
  body: T;                          // Response payload (the envelope above)
  headers: Record<string, string>;  // HTTP response headers
}
```

Not all fields are present on every response — only relevant fields are included (empty/zero fields are omitted).

## Usage

### Sessions

Sessions group related transactions together so they appear as a single flow in the Biometry Dashboard.

```typescript
const session = await sdk.startSession();
const sessionId = session.body.data; // "sess_xxxxxxxx-xxxx-..."

// Pass sessionId to subsequent calls to link them together
await sdk.giveStorageConsent(true, 'Jane Doe', { sessionId });
await sdk.enrollFace(faceFile, 'Jane Doe', false, { sessionId });
```

### Consent

Consent must be collected **before** performing biometric operations. There are two types:

| Type | Required before | Method |
|------|----------------|--------|
| **Authorization** | Face recognition, voice recognition, face matching | `giveAuthorizationConsent()` |
| **Storage** | Face enrollment, voice enrollment | `giveStorageConsent()` |

```typescript
// Authorization consent — required for recognition/verification operations
await sdk.giveAuthorizationConsent(true, 'Jane Doe');

// Storage consent — required for enrollment operations
await sdk.giveStorageConsent(true, 'Jane Doe');
```

Both methods accept optional `sessionId` and `deviceInfo`:

```typescript
await sdk.giveAuthorizationConsent(true, 'Jane Doe', {
  sessionId: 'sess_abc123',
  deviceInfo: { os: 'iOS', browser: 'Safari' },
});
```

> **Important — Consent and video processing:** The `processVideo` endpoint does **not** reject requests without consent. Instead, it silently removes services that require authorization consent (face recognition, voice recognition) and processes only the remaining services (liveness detection, active speaker detection, visual speech recognition). When services are removed, the response includes the header `X-Removed-Services: true`. Always collect consent before calling `processVideo` to ensure all services run.

> **Important — Auto-enrollment:** When **both** authorization and storage consent are given, `processVideo` will automatically enroll the user's face and voice in the background (if not already enrolled). The response header `X-Auto-Enroll: true` is set when this occurs. See [Auto-Enrollment](#auto-enrollment) for details.

### Face Enrollment

Register a user's face for future matching. Requires **storage consent** first.

```typescript
const faceFile = new File([imageBytes], 'face.jpg', { type: 'image/jpeg' });

await sdk.giveStorageConsent(true, 'Jane Doe');
const response = await sdk.enrollFace(faceFile, 'Jane Doe');

// Response envelope:
// {
//   "data": {
//     "enrollment_result": { "code": 0, "description": "Face enrolled successfully" },
//     "document_auth": null
//   },
//   "message": "face enrolled successfully"
// }

console.log(response.body.data.enrollment_result);
// { code: 0, description: "Face enrolled successfully" }
```

If enrolling from an ID document image (e.g. passport photo), set `isDocument` to `true`. This improves face detection accuracy for document photos:

```typescript
const response = await sdk.enrollFace(documentImage, 'Jane Doe', true);
```

When `isDocument` is `true`, the response may include `document_auth` with extracted document data alongside the enrollment result.

An `enrollment_result.code` of `0` means success. Non-zero codes indicate a failure (e.g. no face detected, multiple faces detected).

### Voice Enrollment

Register a user's voice for speaker verification. Requires **storage consent** first.

```typescript
const audioFile = new File([audioBytes], 'voice.wav', { type: 'audio/wav' });

await sdk.giveStorageConsent(true, 'Jane Doe');
const response = await sdk.enrollVoice(
  audioFile,
  'Jane Doe',
  'jane-doe-id',    // unique identifier
  'one two three'   // the phrase spoken in the audio
);

// Response envelope:
// {
//   "data": {
//     "status": "good",
//     "qa_combined": { ... },
//     "qa_list": [...]
//   },
//   "message": "voice registered successfully"
// }

console.log(response.body.data.status); // "good" | "qafailed" | "enrolled" | "error"
```

> **Note:** The voice enrollment identifier is derived from the `userFullName` parameter (spaces are replaced with underscores). For example, `'Jane Doe'` becomes `Jane_Doe` as the enrollment ID on the backend. The `uniqueId` parameter is sent in the request but the server-side identifier is derived from the user's full name.

### Video Processing (Liveness & Recognition)

Process a video to perform up to five biometric checks in a single request:

1. **Face Liveness Detection** — determines if the face in the video is a real person (not a photo/screen replay)
2. **Active Speaker Detection** — verifies the person is actively speaking
3. **Visual Speech Recognition** — reads lips to verify the spoken phrase matches
4. **Face Recognition** — identifies the face against enrolled faces (requires authorization consent)
5. **Voice Recognition** — verifies the speaker's voice against enrolled voiceprints (requires authorization consent)

```typescript
const videoFile = new File([videoBytes], 'video.mp4', { type: 'video/mp4' });

await sdk.giveAuthorizationConsent(true, 'Jane Doe');
const response = await sdk.processVideo(videoFile, '12345678', 'Jane Doe');

// Response envelope:
// {
//   "data": {
//     "Face Liveness Detection": { "code": 0, "description": "Real face detected", "result": true },
//     "Active Speaker Detection": { "code": 0, "description": "Active speaker detected", "result": 1 },
//     "Visual Speech Recognition": { "code": 0, "description": "...", "result": "12345678" },
//     "Face Recognition": { "code": 0, "description": "Face identified" },
//     "Voice Recognition": { "status": "good", "id": "Jane_Doe", "score": 0.92, ... }
//   },
//   "scoring_result": "pass",
//   "score": 0.95,
//   "decision_reasons": [],
//   "message": "video processed successfully"
// }

console.log(response.body.scoring_result); // "pass" | "fail" | "refer"
console.log(response.body.data['Face Liveness Detection'].result); // true or false
console.log(response.body.data['Visual Speech Recognition'].result); // the recognized phrase
```

The `phrase` parameter is a set of digits the user speaks aloud in the video (e.g. `'12345678'`). This is used for visual speech recognition and voice verification.

The `scoring_result` field indicates the overall outcome:
- `"pass"` — all checks passed
- `"fail"` — one or more checks failed
- `"refer"` — needs manual review

When the result is `"fail"` or `"refer"`, check `decision_reasons` for specific failure causes.

#### Auto-Enrollment

When **both** authorization consent and storage consent have been given for the user, `processVideo` automatically enrolls the user's face and voice in the background. This is useful for registration flows where you want to verify liveness and enroll in a single step.

Auto-enrollment behavior:
- **Face**: Enrolled from the video if the user's face is not already enrolled
- **Voice**: Enrolled from the video audio if the user's voice is not already enrolled for the given phrase
- **Response header**: `X-Auto-Enroll: true` is set when auto-enrollment is triggered
- **Non-blocking**: Enrollment happens asynchronously and does not affect the video processing response

```typescript
// Collect both consents to enable auto-enrollment
await sdk.giveStorageConsent(true, 'Jane Doe', { sessionId });
await sdk.giveAuthorizationConsent(true, 'Jane Doe', { sessionId });

// processVideo will now auto-enroll face and voice in the background
const response = await sdk.processVideo(videoFile, '12345678', 'Jane Doe', { sessionId });

// Check if auto-enrollment was triggered
if (response.headers['x-auto-enroll'] === 'true') {
  console.log('Face and voice enrolled automatically');
}
```

> **Tip:** If you only need liveness detection (without face/voice recognition), you can call `processVideo` without providing a `userFullName`. Services that require consent (face recognition, voice recognition) will be skipped.

### Face Matching

Compare a reference image (selfie, ID photo, etc.) against a face from a video to verify identity.

**Option A — Provide both image and video:**

```typescript
const imageFile = new File([imgBytes], 'face.jpg', { type: 'image/jpeg' });
const videoFile = new File([vidBytes], 'video.mp4', { type: 'video/mp4' });

const response = await sdk.matchFaces(imageFile, videoFile, 'Jane Doe');

// Response envelope:
// {
//   "data": {
//     "code": 0,
//     "result": 1,
//     "description": "Successful check",
//     "anchor": { "code": 0, "description": "One face found in the image" },
//     "target": { "code": 0, "description": "One face found in the video" }
//   },
//   "scoring_result": { "status": "pass", ... },
//   "decision_reasons": [],
//   "message": "faces match result is here"
// }

console.log(response.body.data.result);      // 1 = match, 0 = no match
console.log(response.body.data.description); // "Successful check"
```

| `data.result` | Meaning |
|-------|---------|
| `1` | Faces match |
| `0` | Faces do not match |

The `anchor` field describes the face detected in the reference image, and `target` describes the face detected in the video. A `code` of `0` means a face was successfully found.

**Option B — Reuse video from a previous `processVideo` call:**

If you already called `processVideo` with a `sessionId`, you can skip uploading the video again:

```typescript
const session = await sdk.startSession();
const sessionId = session.body.data;

// Step 1: Process video within the session
await sdk.processVideo(videoFile, '12345678', 'Jane Doe', { sessionId });

// Step 2: Match faces reusing the same video
const response = await sdk.matchFaces(
  imageFile,       // Reference image
  undefined,       // No video file needed
  'Jane Doe',
  true,            // usePrefilledVideo
  { sessionId }    // Same session ID
);
```

### Document Authentication

Extract and validate information from identity documents (passports, ID cards, driver's licenses). Only JPG, JPEG, and PNG images are accepted.

```typescript
const docFile = new File([docBytes], 'passport.jpg', { type: 'image/jpeg' });

await sdk.giveAuthorizationConsent(true, 'Jane Doe', { sessionId });
const response = await sdk.checkDocAuth(docFile, 'Jane Doe', {
  sessionId,
  inHouseCheck: true,
});

// Response envelope:
// {
//   "data": {
//     "document_type": "National Identification Card",
//     "first_name": "JANE",
//     "last_name": "DOE",
//     "birth_date": "1990-01-01",
//     "document_number": "AB1234567",
//     "country_code": "AUS",
//     "sex": "FEMALE",
//     "expiry_date": "2028-08-01",
//     "portrait_photo": "<base64>",
//     "face_image_base64": "<base64>",
//     "current_result": "Passed",
//     ...
//   },
//   "scoring_result": "pass",
//   "message": "Document uploaded successfully, looks like it's authentic"
// }

const doc = response.body.data;
console.log(doc.first_name);          // "JANE" (uppercase)
console.log(doc.last_name);           // "DOE" (uppercase)
console.log(doc.document_number);     // "AB1234567"
console.log(doc.document_type);       // "National Identification Card"
console.log(doc.portrait_photo);      // Base64-encoded photo from document OCR
console.log(doc.face_image_base64);   // Base64-encoded cropped face image
```

> **Note:** `first_name` and `last_name` are returned in uppercase. The `portrait_photo` field contains the photo extracted via OCR/field parsing, while `face_image_base64` contains a cropped face image detected and extracted from the document.

The `scoring_result` field indicates document validation outcome: `"pass"` if the document looks authentic, `"fail"` otherwise.

The `inHouseCheck` option uses Biometry's in-house document verification (GPT + ML-based). When set to `false` (or omitted), the external IDScan verification service is used instead. The in-house check is the default and recommended option.

## Common Flows

### Identity Verification (KYC)

A typical identity verification flow combines consent, liveness, and face matching:

```typescript
const sdk = new BiometrySDK('YOUR_API_KEY');
const session = await sdk.startSession();
const sessionId = session.body.data;
const userName = 'Jane Doe';

// 1. Collect both consents
await sdk.giveStorageConsent(true, userName, { sessionId });
await sdk.giveAuthorizationConsent(true, userName, { sessionId });

// 2. Process live video for liveness + auto-enrollment
//    (auto-enrolls face and voice since both consents are given)
const liveVideo = new File([videoBytes], 'video.mp4', { type: 'video/mp4' });
const videoResult = await sdk.processVideo(liveVideo, '12345678', userName, { sessionId });

if (videoResult.body.scoring_result !== 'pass') {
  console.error('Liveness check failed:', videoResult.body.decision_reasons);
  return;
}

// 3. Match the ID photo against the live video (reusing video from step 2)
const idPhoto = new File([idBytes], 'id.jpg', { type: 'image/jpeg' });
const matchResult = await sdk.matchFaces(
  idPhoto, undefined, userName, true, { sessionId }
);

if (matchResult.body.data.result === 1) {
  console.log('Identity verified!');
} else {
  console.log('Face mismatch — verification failed');
}
```

> **Note:** In this flow, explicit face enrollment (step 2 from the previous version) is no longer needed. Since both consents are given, `processVideo` auto-enrolls the user's face and voice in the background. You can proceed directly to face matching.

### Document-Only Verification

For flows that only need document data extraction:

```typescript
const sdk = new BiometrySDK('YOUR_API_KEY');

await sdk.giveAuthorizationConsent(true, 'Jane Doe');

const result = await sdk.checkDocAuth(documentFile, 'Jane Doe', {
  inHouseCheck: true,
});

const doc = result.body.data;
console.log(`${doc.first_name} ${doc.last_name}`);
console.log(`DOB: ${doc.birth_date}`);
console.log(`Document: ${doc.document_number}`);
console.log(`Valid: ${result.body.scoring_result}`); // "pass" or "fail"
```

### Full KYC with Document Authentication

Combine document authentication with liveness verification and face matching for a comprehensive KYC flow:

```typescript
const sdk = new BiometrySDK('YOUR_API_KEY');
const session = await sdk.startSession();
const sessionId = session.body.data;
const userName = 'Jane Doe';

// 1. Collect both consents
await sdk.giveStorageConsent(true, userName, { sessionId });
await sdk.giveAuthorizationConsent(true, userName, { sessionId });

// 2. Authenticate the ID document
const docImage = new File([docBytes], 'passport.jpg', { type: 'image/jpeg' });
const docResult = await sdk.checkDocAuth(docImage, userName, {
  sessionId,
  inHouseCheck: true,
});

if (docResult.body.scoring_result !== 'pass') {
  console.error('Document authentication failed');
  return;
}

// 3. Process live video (liveness + auto-enrollment)
const liveVideo = new File([videoBytes], 'video.mp4', { type: 'video/mp4' });
const videoResult = await sdk.processVideo(liveVideo, '12345678', userName, { sessionId });

if (videoResult.body.scoring_result !== 'pass') {
  console.error('Liveness check failed');
  return;
}

// 4. Match document photo against live video
const matchResult = await sdk.matchFaces(
  docImage, undefined, userName, true, { sessionId }
);

if (matchResult.body.data.result === 1) {
  console.log('KYC complete — identity verified!');
} else {
  console.log('Face mismatch — document does not match live video');
}
```

## API Reference

### `new BiometrySDK(apiKey)`

Creates a new SDK instance.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `apiKey` | `string` | Yes | Your Biometry project API key |

---

### `startSession()`

Starts a new session for grouping transactions.

**Returns:** `Promise<ApiResponse<SessionResponse>>`

```typescript
// SessionResponse
{ data: string; message: string }
```

---

### `giveAuthorizationConsent(isConsentGiven, userFullName, props?)`

Submits authorization consent. Required before recognition and verification operations.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `isConsentGiven` | `boolean` | Yes | Whether the user granted consent |
| `userFullName` | `string` | Yes | User's full name for record-keeping |
| `props.sessionId` | `string` | No | Session ID to link with |
| `props.deviceInfo` | `object` | No | Device metadata |

**Returns:** `Promise<ApiResponse<ConsentResponse>>`

---

### `giveStorageConsent(isStorageConsentGiven, userFullName, props?)`

Submits storage consent. Required before enrollment operations.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `isStorageConsentGiven` | `boolean` | Yes | Whether the user granted storage consent |
| `userFullName` | `string` | Yes | User's full name for record-keeping |
| `props.sessionId` | `string` | No | Session ID to link with |
| `props.deviceInfo` | `object` | No | Device metadata |

**Returns:** `Promise<ApiResponse<ConsentResponse>>`

---

### `enrollFace(face, userFullName, isDocument?, props?)`

Enrolls a user's face for biometric authentication.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `face` | `File` | Yes | Image file containing the face |
| `userFullName` | `string` | Yes | User's full name |
| `isDocument` | `boolean` | No | Set `true` if image is from an ID document |
| `props.sessionId` | `string` | No | Session ID to link with |
| `props.deviceInfo` | `object` | No | Device metadata |

**Returns:** `Promise<ApiResponse<FaceEnrollmentResponse>>`

Response `data` contains:
- `enrollment_result.code` — `0` for success, non-zero for failure
- `enrollment_result.description` — human-readable result
- `document_auth` — extracted document data (when `isDocument` is `true`)

---

### `enrollVoice(audio, userFullName, uniqueId, phrase, props?)`

Enrolls a user's voice for speaker verification.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `audio` | `File` | Yes | Audio file with the user's voice |
| `userFullName` | `string` | Yes | User's full name (also used as the enrollment identifier) |
| `uniqueId` | `string` | Yes | Unique identifier for the enrollment |
| `phrase` | `string` | Yes | The phrase spoken in the audio |
| `props.sessionId` | `string` | No | Session ID to link with |
| `props.deviceInfo` | `object` | No | Device metadata |

**Returns:** `Promise<ApiResponse<VoiceEnrollmentResponse>>`

Response `data` contains:
- `status` — `"good"` (accepted), `"enrolled"` (fully enrolled), `"qafailed"` (quality check failed), or `"error"`
- `qa_combined` — combined quality assessment results
- `qa_list` — per-file quality results

---

### `processVideo(video, phrase, userFullName?, props?)`

Processes a video for liveness detection, face recognition, active speaker detection, visual speech recognition, and voice recognition.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `video` | `File` | Yes | Video file to process |
| `phrase` | `string` | Yes | Digits the user speaks in the video |
| `userFullName` | `string` | No | User's full name (required for face/voice recognition) |
| `props.sessionId` | `string` | No | Session ID to link with |
| `props.deviceInfo` | `object` | No | Device metadata |

**Returns:** `Promise<ApiResponse<ProcessVideoResponse>>`

The `scoring_result` field indicates the overall outcome: `"pass"`, `"fail"`, or `"refer"` (needs manual review).

When both authorization and storage consent are given, face and voice are automatically enrolled in the background. The response header `X-Auto-Enroll: true` is set when auto-enrollment occurs.

---

### `matchFaces(image, video?, userFullName?, usePrefilledVideo?, props?)`

Compares a reference image against a face from a video.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `image` | `File` | Yes | Reference image containing a face |
| `video` | `File` | No | Video file with a face to compare. Required unless `usePrefilledVideo` is `true` |
| `userFullName` | `string` | No | User's full name |
| `usePrefilledVideo` | `boolean` | No | Reuse video from a previous `processVideo` call in the same session |
| `props.sessionId` | `string` | Conditional | Required if `usePrefilledVideo` is `true` |
| `props.deviceInfo` | `object` | No | Device metadata |

**Returns:** `Promise<ApiResponse<FaceMatchResponse>>`

Response `data` contains:
- `result` — `1` for match, `0` for no match
- `code` — `0` for successful comparison
- `description` — human-readable result
- `anchor` — face detection result for the reference image
- `target` — face detection result for the video

---

### `checkDocAuth(document, userFullName, props?)`

Authenticates an identity document and extracts its data.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `document` | `File` | Yes | Document image file (JPG, JPEG, or PNG only) |
| `userFullName` | `string` | Yes | User's full name |
| `props.sessionId` | `string` | No | Session ID to link with |
| `props.deviceInfo` | `object` | No | Device metadata |
| `props.inHouseCheck` | `boolean` | No | Use in-house document verification (default behavior) |

**Returns:** `Promise<ApiResponse<DocAuthInfo>>`

Response `data` contains document fields including `first_name`, `last_name`, `birth_date`, `document_number`, `document_type`, `country_code`, `portrait_photo` (base64), and `face_image_base64` (cropped face, base64).

---

### Response Headers

Useful headers returned by the API:

| Header | Description |
|--------|-------------|
| `x-request-id` | Unique request identifier for debugging |
| `x-auto-enroll` | Set to `"true"` when `processVideo` triggers auto-enrollment |
| `x-removed-services` | Set to `"true"` when consent-dependent services were removed from video processing |

```typescript
const response = await sdk.processVideo(videoFile, '12345678', 'Jane Doe');

console.log(response.headers['x-request-id']);
console.log(response.headers['x-auto-enroll']);     // "true" if auto-enrolled
console.log(response.headers['x-removed-services']); // "true" if services were skipped
```

## Error Handling

All SDK methods throw errors on validation failures or unsuccessful HTTP responses. Always wrap calls in `try/catch`:

```typescript
try {
  const response = await sdk.processVideo(videoFile, '12345678', 'Jane Doe');
  // Handle success
} catch (error) {
  console.error(error.message);
  // Example: "Error 400: 'phrase' form value is required"
}
```

Common error scenarios:

| Scenario | When it happens |
|----------|-----------------|
| Missing API key | `new BiometrySDK('')` |
| Missing required parameter | e.g. calling `enrollFace` without a file or name |
| No face detected | Face enrollment with an image that has no detectable face |
| Multiple faces detected | Face enrollment with an image containing more than one face |
| Liveness check failed | Video processing detects a spoofing attempt |
| No speech detected | Voice enrollment with an audio file containing no speech |
| Network failure | Server unreachable or request timeout |
| Consent not given | Calling `enrollFace` or `enrollVoice` without storage consent |
| Prefilled video without session | Calling `matchFaces` with `usePrefilledVideo: true` but no `sessionId` |
| No video found for reuse | Using `usePrefilledVideo` in a session that has no prior `processVideo` call |
| Invalid document format | Calling `checkDocAuth` with a non-JPG/JPEG/PNG file |
| File size exceeded | Uploading a file larger than 50MB |

## Security & Privacy

1. **Protect your API key** — use environment variables or a server-side proxy. Never commit keys to source control.
2. **Obtain explicit consent** — always collect authorization and storage consent through your UI before calling biometric APIs.
3. **Data minimization** — only collect and store data that is necessary for your use case.
4. **Regulatory compliance** — check local regulations (GDPR, CCPA, etc.) regarding the collection and processing of biometric data.

## Examples

If you require additional implementation guidance, please refer to the official API documentation or contact our support team.

## License

This project is licensed under the MIT License.
The full license text is available in the source repository.

## API Documentation

- [Biometry API Documentation](https://developer.biometrysolutions.com/overview/)
