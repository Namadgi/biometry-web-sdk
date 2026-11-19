# Biometry Web SDK

The official JavaScript/TypeScript SDK for integrating [Biometry](https://biometrysolutions.com) identity verification services into web applications. Provides a simple, promise-based API for biometric enrollment, liveness detection, face verification, voice verification, face matching, document authentication, and consent management.

This version targets the **Biometry API v2** gateway (`/api-gateway/v2`).

> **Companion library:** For pre-built React UI components (camera capture, liveness screens, etc.), see [biometry-react-components](https://www.npmjs.com/package/biometry-react-components). Use it alongside this SDK for a faster integration.

## Features

- **Session management** — group related transactions under a single session ID
- **Consent management** — collect authorization and storage consent (required before biometric operations)
- **Face & voice enrollment** — register a user's face and voice
- **Verification** — separate `liveness`, `faceVerify`, and `voiceVerify` operations
- **Face matching** — compare a client-provided reference image against a live capture
- **Document authentication** — extract and validate data from ID documents (passports, ID cards, etc.)
- **Full TypeScript support** — ships with complete type definitions
- **Framework-agnostic** — works with React, Angular, Vue, vanilla JS, or any web framework

## Migrating from v1 (SDK v2.x → v3.x)

API v2 is a breaking change. Key differences:

| v1 | v2 |
|----|----|
| Users identified by `userFullName` (via `X-User-Fullname` header) | Users identified by an opaque **`userId`** you provide, sent in a JSON `request` part |
| `processVideo(video, phrase, userFullName?)` | Split into **`liveness()`**, **`faceVerify()`**, **`voiceVerify()`** |
| `enrollFace(face, userFullName, isDocument?)` | `enrollFace(face, userId, { isDocument })` |
| `enrollVoice(audio, userFullName, uniqueId, phrase)` | `enrollVoice(audio, userId, phrase, { vocabulary })` |
| `matchFaces(image, video?, userFullName?, usePrefilledVideo?, props?)` | `matchFaces(referenceImage, userId, { video, useSessionVideo, sessionId })` |
| `checkDocAuth(document, userFullName, { inHouseCheck, mrzValidation })` | `checkDocAuth(document, { provider, mrzProvider, sessionId })` |
| Session ID at `response.body.data` (string) | Session ID at `response.body.data.session_id` |
| Ad-hoc error body | Standard error envelope, surfaced as `BiometryApiError` |

Consent (`giveAuthorizationConsent` / `giveStorageConsent`) is served by the dedicated consent service and is **unchanged** — it still uses `userFullName`.

## Getting Started

### Prerequisites

- An active Biometry project with an **API key** (obtain one from the [Biometry Dashboard](https://console.biometrysolutions.com))
- Node.js 16+ (for npm-based projects) or any modern browser with ES module support

### Installation

```bash
npm install biometry-sdk
```

### Initialization

There are two ways to run the SDK. In the browser, use **proxy mode** so your API key never ships in the page.

#### Proxy mode (browser, recommended)

Your API key is project-wide and long-lived, and anything in a web bundle can be read by anyone who opens devtools. Keep the key on your backend and point the SDK at it with `baseUrl`:

```typescript
import { BiometrySDK } from 'biometry-sdk';

const sdk = new BiometrySDK({
  baseUrl: 'https://your-backend.example.com/biometry',
  // Optional: your own app's credentials for the proxy. A function is called
  // before every request, so a refreshed token is picked up.
  headers: () => ({ Authorization: `Bearer ${getAppSessionToken()}` }),
});
```

> **Warning:** do not set `apiKey` together with `baseUrl` in the browser. The SDK then sends your Biometry API key as `Authorization: Bearer <apiKey>` to the `baseUrl` host, so it is in the page and in every request to your proxy.

In proxy mode each call goes to `baseUrl` plus its own short path: the API v2 path without Biometry's `/api-gateway/v2` prefix. So `startSession()` calls `https://your-backend.example.com/biometry/sessions`, and your backend can name its routes as it likes. Without an `apiKey` the SDK sends no `Authorization` header of its own.

| SDK method | `paths` key | Default proxy path |
|------------|-------------|--------------------|
| `startSession()` | `startSession` | `POST /sessions` (the SDK adds `?warmup=true` when asked) |
| `endSession()` | `endSession` | `POST /sessions/{session_id}/end` |
| `liveness()` | `liveness` | `POST /liveness` |
| `faceVerify()` | `faceVerify` | `POST /face-verify` |
| `voiceVerify()` | `voiceVerify` | `POST /voice-verify` |
| `matchFaces()` | `faceMatch` | `POST /face-match` |
| `enrollFace()` | `enrollFace` | `POST /enrollments/face` |
| `enrollVoice()` | `enrollVoice` | `POST /enrollments/voice` |
| `checkDocAuth()` | `checkDocument` | `POST /documents/check` |

The defaults are exported as `DEFAULT_PROXY_PATHS` (keys typed as `ProxyOperation`). To use other routes, override single calls with `paths`:

```typescript
const sdk = new BiometrySDK({
  baseUrl: 'https://your-backend.example.com',
  paths: {
    liveness: '/kyc/liveness-check',
    endSession: '/kyc/sessions/{session_id}/finish',
  },
});
```

Each override must start with `/`, contain no `?` or `#`, and contain exactly the placeholders of the default path (`{session_id}` for `endSession`, none for the others). Placeholder values are URI-encoded. An unknown key or an invalid path throws in the constructor. `paths` only applies in proxy mode: without `baseUrl` it is ignored, with a `console.warn`.

`giveAuthorizationConsent()` and `giveStorageConsent()` throw in proxy mode: your backend records consent itself (see below).

Your backend must:

1. Authenticate your user (session cookie, JWT, or the `headers` you pass here).
2. Accept only the paths your app uses.
3. Never pass the client's body through. Rebuild each request from the fields and files that call needs, **set** `user_id` to the signed-in user (do not just compare it: the gateway's JSON decoder matches keys case-insensitively, so `USER_ID` or a duplicate key can slip past a check), keep a `session_id` only if it was started for that user, and drop the query string (except `warmup=true` on session start). The same goes for IDs in the path: answer `403` unless a `{user_id}` is the signed-in user and a `{session_id}` was started for that user, so nobody can end another user's session or read their consent approvals.
4. Send the rebuilt request to the matching Biometry endpoint, `https://api.biometrysolutions.com/api-gateway/v2` plus the default path (for example `POST /liveness` goes to `/api-gateway/v2/liveness`), adding `Authorization: Bearer <your API key>`.

[`examples/proxy-server`](examples/proxy-server/) is a runnable, zero-dependency proxy that does all of this, with a `node --test` suite. It also shows the two jobs your backend must do itself in proxy mode:

- **Consent.** Record the user's authorization and storage consent from your backend with your API key (`PUT /api-gateway/v2/users/{user_id}/consents` with `{"authorization": true, "storage": true}`), for example in your onboarding flow before the first enrollment. The SDK's consent methods throw in proxy mode, so a browser can't record consent for another user; call your own backend instead (the example proxy has `POST /onboarding/consent`).
- **Liveness challenge.** Your backend issues the digits the user reads for a session, keeps its own copy, and writes it into `phrase` on `liveness` and `voiceVerify` (each may use it once per session; pass the `sessionId`), ignoring the phrase the browser sends. `faceVerify` needs no challenge.
- Your user ids must be 3 to 128 characters of `A-Za-z0-9._:@-`.

The SDK methods still take a `userId` and a `phrase` in proxy mode. Pass your backend's id for the signed-in user as `userId` (the proxy sets `user_id` from your session anyway), and pass the challenge you displayed as `phrase` on `liveness()` and `voiceVerify()`: the proxy overwrites it with its own copy, but the SDK still requires a non-empty value.

```typescript
await sdk.liveness(video, currentUser.id, displayedChallenge, { sessionId });
```

The example proxy needs these Biometry API gateway changes deployed, in this order: biometry-api-gateway #147 (makes `phrase` optional on v2 face-verify; the example sends face-verify without one, which the current gateway refuses), then #148 (adds the `PUT /api-gateway/v2/users/{user_id}/consents` endpoint the example records consent through).

If the proxy is on another origin and authenticates with cookies, pass `credentials: 'include'`; the proxy must then answer CORS with your page's exact origin and `Access-Control-Allow-Credentials: true`.

`baseUrl` must be an absolute `http` or `https` URL with no `?` or `#` in it; anything else throws. `headers` replace SDK headers with the same name, compared case-insensitively, except `Content-Type`, which the SDK sets from the body (JSON, or multipart with its boundary). `headers` and `credentials` only apply in proxy mode: without `baseUrl` they are ignored, with a `console.warn`.

#### Direct mode (server-side or testing)

On your own server (Node 18+), or for quick tests, pass the API key and the SDK calls the Biometry API directly:

```typescript
const sdk = new BiometrySDK('YOUR_API_KEY');
// same as: new BiometrySDK({ apiKey: 'YOUR_API_KEY' })
```

The API key is sent as a Bearer token on every request. `new BiometrySDK('')` throws `API Key is required to initialize the SDK.`; options with neither `apiKey` nor `baseUrl` throw `apiKey or baseUrl is required to initialize the SDK.`

> **Security:** Never put your API key in client-side code shipped to production. Use proxy mode in the browser.

## Response Structure

All API v2 gateway responses follow a standard **success envelope**:

```text
{
  "data": { ... },            // endpoint-specific payload (omitted when there is none)
  "decision": {               // present only when a scoring system applies to the API key
    "status": "pass" | "fail" | "refer",
    "score": 0.95,
    "reasons": ["reason1"]
  },
  "meta": {
    "request_id": "…",
    "message": "human-readable status message"
  }
}
```

The SDK wraps this in an `ApiResponse<T>` that also includes the HTTP response headers:

```typescript
interface ApiResponse<T> {
  body: T;                          // the success envelope above
  headers: Record<string, string>;  // HTTP response headers
}
```

So biometric results live under `response.body.data`, the scoring decision (when configured) under `response.body.decision`, and request metadata under `response.body.meta`.

## Usage

### Sessions

Sessions group related transactions together so they appear as a single flow in the Biometry Dashboard.

```typescript
const session = await sdk.startSession();
const sessionId = session.body.data.session_id;

// Pass sessionId to subsequent calls to link them together
await sdk.faceVerify(videoFile, 'user-123', undefined, { sessionId });

// End the session (optionally with a phone number for a SIM-swap check)
await sdk.endSession(sessionId, { phoneNumber: '+15551234567' });
```

Pass `{ warmup: true }` to `startSession` to pre-warm the ML services in the background.

### Consent

Consent must be collected **before** performing biometric operations. It is served by the consent service; despite the parameter name `userFullName`, pass your `user_id`, not the person's name.

> **Proxy mode:** record consent from your backend instead (see [Proxy mode](#proxy-mode-browser-recommended)); with `baseUrl` set these methods throw. The `/v2/consents` endpoints are a different feature (your own custom consent documents) and do not unlock enrollment.

| Type | Required before | Method |
|------|----------------|--------|
| **Authorization** | Face/voice recognition, face matching | `giveAuthorizationConsent()` |
| **Storage** | Face/voice enrollment | `giveStorageConsent()` |

```typescript
await sdk.giveAuthorizationConsent(true, 'user-123');
await sdk.giveStorageConsent(true, 'user-123');
```

Both accept optional `sessionId` and `deviceInfo`.

### Face Enrollment

Register a user's face for future verification. Requires **storage consent** first.

```typescript
const faceFile = new File([imageBytes], 'face.jpg', { type: 'image/jpeg' });

const response = await sdk.enrollFace(faceFile, 'user-123');
console.log(response.body.data); // { enrolled: true, user_id: 'user-123' }
```

If enrolling from an ID document image (e.g. passport photo), set `isDocument` to improve face detection:

```typescript
await sdk.enrollFace(documentImage, 'user-123', { isDocument: true });
```

### Voice Enrollment

Register a user's voice for voice recognition. Requires **storage consent** first.

```typescript
const audioFile = new File([audioBytes], 'voice.wav', { type: 'audio/wav' });

const response = await sdk.enrollVoice(audioFile, 'user-123', 'one two three', {
  vocabulary: 'en_digits',
});
console.log(response.body.data); // { enrolled: true, user_id: 'user-123' }
```

The `phrase` is what the user speaks in the audio. Numeric phrases (e.g. `'471'`) are normalized to words server-side.

### Verification

The single v1 `processVideo` call is now three focused operations. Each takes a `userId` and the spoken `phrase`.

**Liveness** — face liveness, active speaker detection, and visual speech recognition:

```typescript
const videoFile = new File([videoBytes], 'video.mp4', { type: 'video/mp4' });

const response = await sdk.liveness(videoFile, 'user-123', '12345678', {
  trigger: 'authentication',
  // Optionally skip services from the pipeline:
  excludeServices: ['voice_recognition'],
});
console.log(response.body.data.face_liveness_detection);
```

**Face verification** — verify the face in a video/image against the user's enrolled face:

```typescript
// No phrase needed: pass undefined to give props.
const response = await sdk.faceVerify(videoFile, 'user-123', undefined, { sessionId });
console.log(response.body.data.face_recognition);
```

**Voice verification** — verify speech audio against the user's enrolled voice:

```typescript
const response = await sdk.voiceVerify(audioFile, 'user-123', '12345678', { sessionId });
console.log(response.body.data.voice_recognition);
```

When a scoring system is configured for the API key, check `response.body.decision.status` (`"pass"` / `"fail"` / `"refer"`) and `response.body.decision.reasons`.

### Face Matching

Compare a client-provided reference image (selfie, ID photo, etc.) against a live capture.

**Provide both reference image and video:**

```typescript
const imageFile = new File([imgBytes], 'reference.jpg', { type: 'image/jpeg' });
const videoFile = new File([vidBytes], 'video.mp4', { type: 'video/mp4' });

const response = await sdk.matchFaces(imageFile, 'user-123', { video: videoFile });
console.log(response.body.data.face_recognition);
```

**Reuse the video captured earlier in the session:**

```typescript
const session = await sdk.startSession();
const sessionId = session.body.data.session_id;

await sdk.liveness(videoFile, 'user-123', '12345678', { sessionId });

const response = await sdk.matchFaces(imageFile, 'user-123', {
  useSessionVideo: true,
  sessionId,
});
```

### Document Authentication

Extract and validate information from identity documents. Only JPG, JPEG, and PNG images are accepted.

```typescript
const docFile = new File([docBytes], 'passport.jpg', { type: 'image/jpeg' });

const response = await sdk.checkDocAuth(docFile, {
  sessionId,
  provider: 'inhouse',     // 'inhouse' (default) or 'idscan'
  mrzProvider: 'inhouse',  // optional MRZ extraction provider
});

const doc = response.body.data;
console.log(doc.first_name, doc.last_name);
console.log(doc.document_number, doc.expiry_date);
console.log(doc.portrait_photo); // base64
```

`provider` selects the document authenticity engine: `inhouse` (Biometry's GPT + ML flow, default) or `idscan` (external service). `mrzProvider` selects the MRZ extraction engine. Both default to the project configuration when omitted.

## Common Flows

### Identity Verification (KYC)

```typescript
const sdk = new BiometrySDK('YOUR_API_KEY');
const session = await sdk.startSession();
const sessionId = session.body.data.session_id;
const userId = 'user-123';

// 1. Collect consent
await sdk.giveStorageConsent(true, userId, { sessionId });
await sdk.giveAuthorizationConsent(true, userId, { sessionId });

// 2. Liveness check on the live capture
const liveVideo = new File([videoBytes], 'video.mp4', { type: 'video/mp4' });
const liveness = await sdk.liveness(liveVideo, userId, '12345678', { sessionId });
if (liveness.body.decision?.status === 'fail') {
  console.error('Liveness failed:', liveness.body.decision.reasons);
  return;
}

// 3. Match the ID photo against the live capture (reusing the session video)
const idPhoto = new File([idBytes], 'id.jpg', { type: 'image/jpeg' });
const match = await sdk.matchFaces(idPhoto, userId, { useSessionVideo: true, sessionId });
console.log(match.body.data.face_recognition);

await sdk.endSession(sessionId);
```

### Document-Only Verification

```typescript
const sdk = new BiometrySDK('YOUR_API_KEY');

// e.g. from an <input type="file"> element
const documentFile = fileInput.files[0];

const result = await sdk.checkDocAuth(documentFile, { provider: 'inhouse' });
const doc = result.body.data;
console.log(`${doc.first_name} ${doc.last_name}`);
console.log(`DOB: ${doc.birth_date}`);
console.log(`Document: ${doc.document_number}`);
```

## API Reference

### `new BiometrySDK(apiKey)` / `new BiometrySDK(options)`

Creates a new SDK instance. Passing a string is the same as `{ apiKey }`.

| Option | Type | Required | Description |
|-----------|------|----------|-------------|
| `apiKey` | `string` | Unless `baseUrl` is set | Your Biometry project API key, sent as `Authorization: Bearer <apiKey>`. Leave it out in proxy mode. |
| `baseUrl` | `string` | No | Your backend proxy. Calls go to `baseUrl` plus their proxy path (`DEFAULT_PROXY_PATHS`, the v2 path without `/api-gateway/v2`). |
| `paths` | `Partial<Record<ProxyOperation, string>>` | No | Proxy mode only. Overrides the proxy path of single calls. Must start with `/`, no `?` or `#`, same placeholders as the default; invalid entries or unknown keys throw. Ignored with a warning without `baseUrl`. |
| `headers` | `Record<string, string>` or `() => Record<string, string> \| Promise<Record<string, string>>` | No | Proxy mode only. Extra headers sent on every request. They replace an SDK header with the same name (case-insensitively), including `Authorization`. A custom `Content-Type` is dropped: the SDK sets it from the body. Ignored with a warning without `baseUrl`. |
| `credentials` | `RequestCredentials` | No | Proxy mode only. Passed to `fetch`. Use `'include'` for a cross-origin proxy that authenticates with cookies. Ignored with a warning without `baseUrl`. |

---

### `startSession(props?)`

Starts a new session for grouping transactions.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `props.warmup` | `boolean` | No | Pre-warm ML services in the background |

**Returns:** `Promise<ApiResponse<SuccessEnvelope<{ session_id: string }>>>`

---

### `endSession(sessionId, props?)`

Ends a session. Optionally runs a SIM-swap fraud check.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | `string` | Yes | The session to end |
| `props.phoneNumber` | `string` | No | Phone number for the SIM-swap check |

**Returns:** `Promise<ApiResponse<SuccessEnvelope>>`

---

### `giveAuthorizationConsent(isConsentGiven, userFullName, props?)` / `giveStorageConsent(isStorageConsentGiven, userFullName, props?)`

Submit authorization / storage consent (served by the consent service). Direct mode only: with `baseUrl` (proxy mode) they throw, because your backend records consent.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `isConsentGiven` / `isStorageConsentGiven` | `boolean` | Yes | Whether the user granted consent |
| `userFullName` | `string` | Yes | Your `user_id` for the user (not the person's name); sent as `user_fullname` |
| `props.sessionId` | `string` | No | Session ID to link with |
| `props.deviceInfo` | `object` | No | Device metadata |

**Returns:** `Promise<ApiResponse<ConsentResponse>>`

---

### `enrollFace(face, userId, props?)`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `face` | `File` | Yes | Image file containing the face |
| `userId` | `string` | Yes | Opaque identity key for the user |
| `props.isDocument` | `boolean` | No | Set `true` if the image is an ID document photo |

**Returns:** `Promise<ApiResponse<SuccessEnvelope<EnrollmentData>>>`

---

### `enrollVoice(audio, userId, phrase, props?)`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `audio` | `File` | Yes | Audio file with the user's voice |
| `userId` | `string` | Yes | Opaque identity key for the user |
| `phrase` | `string` | Yes | The phrase spoken in the audio |
| `props.vocabulary` | `string` | No | Vocabulary constraint (e.g. `'en_digits'`) |

**Returns:** `Promise<ApiResponse<SuccessEnvelope<EnrollmentData>>>`

---

### `liveness(video, userId, phrase, props?)`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `video` | `File` | Yes | Video file to analyse |
| `userId` | `string` | Yes | Opaque identity key for the user |
| `phrase` | `string` | Yes | Digits/words the user speaks |
| `props.sessionId` | `string` | No | Session ID for combined scoring |
| `props.trigger` | `string` | No | Contextual trigger event name |
| `props.vocabulary` | `string` | No | Vocabulary hint (e.g. `'en_digits'`) |
| `props.excludeServices` | `VerificationService[]` | No | Services to skip from the pipeline |

**Returns:** `Promise<ApiResponse<SuccessEnvelope<LivenessData>>>`

---

### `faceVerify(video, userId, phrase?, props?)` / `voiceVerify(voice, userId, phrase, props?)`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `video` / `voice` | `File` | Yes | Video (face) or audio/video (voice) file |
| `userId` | `string` | Yes | Opaque identity key for the user |
| `phrase` | `string` | `voiceVerify`: Yes. `faceVerify`: No | Digits/words the user speaks. The API no longer needs it for `faceVerify`; it is sent only when non-empty. Pass `undefined` to skip it and still give `props` |
| `props.sessionId` | `string` | No | Session ID for combined scoring |
| `props.vocabulary` | `string` | No | Vocabulary hint (e.g. `'en_digits'`) |

**Returns:** `Promise<ApiResponse<SuccessEnvelope<FaceVerifyData>>>` / `Promise<ApiResponse<SuccessEnvelope<VoiceVerifyData>>>`

---

### `matchFaces(referenceImage, userId, props?)`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `referenceImage` | `File` | Yes | Reference portrait to match against |
| `userId` | `string` | Yes | Opaque identity key for the user |
| `props.video` | `File` | Conditional | Live capture. Required unless `useSessionVideo` is `true` |
| `props.useSessionVideo` | `boolean` | No | Reuse the video captured earlier in the session |
| `props.sessionId` | `string` | Conditional | Required when `useSessionVideo` is `true` |

**Returns:** `Promise<ApiResponse<SuccessEnvelope<FaceMatchData>>>`

---

### `checkDocAuth(document, props?)`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `document` | `File` | Yes | Document image file (JPG, JPEG, or PNG only) |
| `props.sessionId` | `string` | No | Session ID to link with |
| `props.provider` | `'inhouse' \| 'idscan'` | No | Document authenticity provider |
| `props.mrzProvider` | `'inhouse' \| 'idscan'` | No | MRZ extraction provider |

**Returns:** `Promise<ApiResponse<SuccessEnvelope<DocAuthInfo>>>`

---

### Response Headers

| Header | Description |
|--------|-------------|
| `x-request-id` | Unique request identifier for debugging (also in `body.meta.request_id`) |

## Error Handling

All SDK methods throw on validation failures or non-2xx responses. HTTP errors are thrown as `BiometryApiError`, which exposes the status, the API v2 error `code`, and response `meta`:

```typescript
import { BiometryApiError } from 'biometry-sdk';

try {
  const response = await sdk.liveness(videoFile, 'user-123', '12345678');
  // Handle success
} catch (error) {
  if (error instanceof BiometryApiError) {
    console.error(error.status);            // e.g. 422
    console.error(error.code);              // e.g. "face_not_detected"
    console.error(error.message);           // "Error 422 [face_not_detected]: No face detected…"
    console.error(error.meta?.request_id);  // for support/debugging
  } else {
    console.error(error); // client-side validation error, network failure, etc.
  }
}
```

Common error scenarios:

| Scenario | When it happens |
|----------|-----------------|
| Missing API key | `new BiometrySDK('')`, or options with neither `apiKey` nor `baseUrl` |
| Missing required parameter | e.g. calling `enrollFace` without a file or `userId` |
| No face detected | Verifying/enrolling with an image that has no detectable face |
| Liveness check failed | A spoofing attempt is detected |
| Consent not given | Enrolling without storage consent, verifying without authorization consent |
| Session required | `matchFaces` with `useSessionVideo: true` but no `sessionId` |
| Invalid document format | `checkDocAuth` with a non-JPG/JPEG/PNG file |

## Security & Privacy

1. **Protect your API key** — keep it on your backend and use [proxy mode](#proxy-mode-browser-recommended) in the browser. Never commit keys to source control.
2. **Obtain explicit consent** — always collect authorization and storage consent through your UI before calling biometric APIs.
3. **Data minimization** — only collect and store data that is necessary for your use case.
4. **Regulatory compliance** — check local regulations (GDPR, CCPA, etc.) regarding biometric data.

## License

This project is licensed under the MIT License. The full license text is available in the source repository.

## API Documentation

- [Biometry API Documentation](https://developer.biometrysolutions.com/overview/)
