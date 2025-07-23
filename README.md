# biometry-sdk

## Overview
The **Biometry Web SDK** is a software development kit designed to simplify the integration of Biometry's API services into your web application. Providing tools, UI components, and utilities enables biometric enrollment (face and voice), liveness checks, and user consent.

## Table of Contents:
- [Installation](#installation)
- [Basic Usage (Direct SDK Methods)](#basic-usage-direct-sdk-methods)
  - [Consents](#1-consents)
    - [1.1 Give Authorization Consent](#11-give-authorization-consent)
    - [1.2 Give Storage Consent](#12-give-storage-consent)
  - [Face Enrollment](#2-face-enrollment)
  - [Voice Enrollment](#3-voice-enrollment)
  - [Process Video](#4-process-video)
- [Advanced Usage And Best Practices](#advanced-usage-and-best-practices)
  - [Typical FaceMatch Flow](#typical-facematch-flow)
  - [Error Handling](#error-handling)
  - [Security And Privacy Considerations](#security-and-privacy-considerations)
- [UI Components](#ui-components)
  - [Face Enrollment Component](#face-enrollment-component)
  - [Process Video Component](#process-video-component)
- [License](#license)
- [More Information](#more-information)
- [Quick Reference](#quick-reference)

## Installation
Install the Biometry Web SDK via npm:
```bash
npm install biometry-sdk
```

## Basic Usage (Direct SDK Methods)
After installing, import and instantiate the BiometrySDK:
```typescript
import { BiometrySDK } from 'biometry-sdk';

// Initialize the SDK with your API key
const sdk = new BiometrySDK('YOUR_API_KEY');
```

### Example
You can find an example in the example/ directory. The example demonstrates how you might integrate the BiometrySDK in a React component with the state.

### 1. Sessions
Session is a way to group transactions together. It is useful when you want to group transactions that are related to each other. For example, you can start a session and then use the session ID to link transactions within a unified group.
  ```javascript
  const response = await sdk.startSession();
  const sessionId = response.data;

  const voiceFile = new File([/* voice audio bytes */], 'voice.wav', { type: 'audio/wav' });
  const faceFile = new File([/* face image bytes */], 'face.jpg', { type: 'image/jpeg' });

  // Use the session ID to link transactions within a unified group
  await sdk.giveStorageConsent(true, 'John Doe', { sessionId });
  await sdk.enrollFace(faceFile, 'John Doe', { sessionId });
  await sdk.enrollVoice(voiceFile, 'John Doe', { sessionId });

  // Go to the Results page in your dashboard and see the transactions grouped by the session ID
  ```

### 2. Consents
#### 2.1 Give Authorization Consent
You **must** obtain user authorization consent before performing any biometric operations (Face Recognition, Voice Recognition, etc.):
  ```javascript
  await sdk.giveAuthorizationConsent(true, 'John Doe');
  // or
  sdk.giveAuthorizationConsent(true, 'John Doe').then(() => {
    console.log('Consent given');
  });
  ```
- The first argument (`true`) indicates that the user has granted consent.
- The second argument is the user’s full name (used for record-keeping within Biometry).

#### 2.2 Give Storage Consent
You **must** obtain user consent before storing biometric data (Face Enrollment, Voice Enrollment):
  ```javascript
  await sdk.giveStorageConsent(true, 'John Doe');
  // or
  sdk.giveStorageConsent(true, 'John Doe').then(() => {
    console.log('Consent given');
  });
  ```
- The first argument (`true`) indicates that the user has granted consent.
- The second argument is the user’s full name (used for record-keeping within Biometry).

### 3. Face Enrollment
Enroll a user’s face for future recognition or matching:
  ```javascript
  const faceFile = new File([/* face image bytes */], 'face.jpg', { type: 'image/jpeg' });
  
  await sdk.giveStorageConsent(true, 'John Doe');
  const faceResponse = await sdk.enrollFace(faceFile, 'John Doe');
  console.log('Face Enrollment Response:', faceResponse);
  ```

### 4. Voice Enrollment
Enroll a user’s voice for future authentication checks:
  ```javascript
  const voiceFile = new File([/* voice audio bytes */], 'voice.wav', { type: 'audio/wav' });

  await sdk.giveStorageConsent(true, 'John Doe');
  const voiceResponse = await sdk.enrollVoice(voiceFile, 'John Doe');
  console.log('Voice Enrollment Response:', voiceResponse);
  ```
### 5. Process Video
Process a user’s video for liveness checks and identity authorization:
  ```javascript
  const videoFile = new File([/* file parts */], 'video.mp4', { type: 'video/mp4' });
  const phrase = "one two three four five six";
  const userFullName = 'John Doe';
  
  await sdk.giveAuthorizationConsent(true, userFullName);
  
  try {
    const response = await sdk.processVideo(videoFile, phrase, userFullName);
    console.log('Process Video Response:', response);
  } catch (error) {
    console.error('Error processing video:', error);
  }
  ```

### 6. Face match
Use matchFaces to compare a reference image (e.g., a document or a captured selfie) with a face from a video:
  ```javascript
  const faceFile = new File([/* face image bytes */], 'face.jpg', { type: 'image/jpeg' });
  const videoFile = new File([/* file parts */], 'video.mp4', { type: 'video/mp4' });
  const userFullName = 'John Doe';

  const faceMatchResponse = await sdk.faceMatch(
    faceFile,
    videoFile,
    userFullName
  );
  ```

You can also reuse a video that was previously processed with the `processVideo` method by passing the same sessionId:
  ```javascript
  const sessionId = await sdk.startSession();

  // First, process a video with a sessionId
  const processVideoResponse = await sdk.processVideo(videoFile, phrase, userFullName, { sessionId });
  
  // Later, reuse the same video for face matching by providing the sessionId
  const faceMatchResponse = await sdk.faceMatch(
    faceFile,
    null, // No need to pass the video file again
    userFullName,
    true, // usePrefilledVideo
    { sessionId }
  );
  ```

### 7. DocAuth
DocAuth is a way to authenticate a user's document. It is useful when you want to authenticate a user's document.
  ```javascript
  const sessionId = await sdk.startSession();

  const documentFile = new File([/* file parts */], 'document.jpg', { type: 'image/jpeg' });
  const userFullName = 'John Doe';
    
  await sdk.giveAuthorizationConsent(true, userFullName, { sessionId });
    
  try {
    const response = await sdk.checkDocAuth(documentFile, userFullName, { sessionId });
    console.log('DocAuth Response:', response);
  } catch (error) {
    console.error('Error checking document:', error);
  }
  ```

## Advanced Usage And Best Practices
### Typical FaceMatch Flow
One common advanced scenario involves document authentication in enrollment face and face matching:
1. Face Enrollment: Capture the user’s live face or the user uploads a picture of their identity document (front side with the face)
2. Process Video: Capture the user’s live face
3. Face Match: Compare the extracted face from the document with the user’s live face to verify identity.

Below is a possible flow (method names in your SDK may vary slightly depending on your integration setup):
  ```javascript
  // 1. Acquire user storage consent
  await sdk.giveStorageConsent(true, userFullName);
  
  // 2. Enroll or capture the user’s face
  //    (Either using enrollFace or processVideo, depending on your user flow)
  const userFaceFile = new File([/* user selfie bytes */], 'image.jpg', { type: 'image/jpeg' });
  const userVideoFile = new File([/* user selfie bytes */], 'video.mp4', { type: 'video/*' });
  const enrollResponse = await sdk.enrollFace(userFaceFile, userFullName);
  
  // 3. Acquire user authorization consent. It's required to use enrolled face for using biometric data.
  await sdk.giveAuthorizationConsent(true, userFullName);

  // 4. Face Match (Compare video face with user’s enrolled face)
  const faceMatchResponse = await sdk.faceMatch(
    userFaceFile,
    userVideoFile,
    userFullName
  );
  
  // 5. Evaluate the faceMatch result
  if (faceMatchResponse.matchResult === 'match') {
    console.log('User video face matches user’s live face. Identity verified!');
  } else {
    console.log('User video face does NOT match. Additional verification needed.');
  }
  ```

### Error Handling
All SDK calls can throw errors for various reasons:
- Network/Connection Issues
- Invalid File Types
- No Face Detected (Face Enrollment)
- No Speech Detected (Voice Enrollment)
- Multiple Faces Detected (Face Enrollment)
- Liveness Check Failure (Process Video)

Always wrap calls in try/catch and provide user-friendly messages or fallback logic.
  ```javascript
  try {
    const response = await sdk.faceMatch(...);
    // handle success
  } catch (error) {
    // handle error
    console.error('Face match error:', error);
  }
  ```
### Security And Privacy Considerations
1. **Protect Your API Key:** Avoid storing your API key in client-side code if possible. Use environment variables or server-side proxies.
2. **Obtain Explicit Consent:** Ensure you have a transparent process for obtaining and storing user consent.
3. **Data Minimization:** Only store data that is required for your use case.
4. **Regulatory Compliance:** Check local regulations (GDPR, CCPA, etc.) for storing and processing biometric data.

## UI Components
In addition to direct SDK methods, the Biometry Web SDK offers reusable Web Components that handle user interactions (camera, video recording, error states) automatically.
The Biometry Web SDK includes reusable, customizable web components for crucial features. These components are easy to embed into your application and handle the most common biometric operations with minimal setup.

### Integration
**Option 1: Using npm (Recommended for full SDK usage)**
1. Install the SDK package via **npm**:
    ```bash
    npm install biometry-sdk
    ```
2. Import the component in your **index.js** or equivalent JavaScript file:
    ```javascript
    // index.js
    import './node_modules/biometry-sdk/dist/biometry-sdk.esm.js';
    ```
**Option 2: Using CDN (Quick Integration)**
```html
<script type="module" src="https://cdn.jsdelivr.net/npm/biometry-sdk/dist/biometry-sdk.esm.js"></script>
```

### Face Enrollment Component
This component provides an intuitive interface for enrollment users with their cameras. It integrates directly with the `BiometrySDK backend`, managing camera capture, consent checks, and error handling.

### Usage
**Required attributes:**
- `endpoint`: The URL of your endpoint that will process the [face enrollment](https://developer.biometrysolutions.com/api/face-enrollment/). All captured data will be sent to the endpoint.
- `user-fullname`: The user’s full name (used in data storage and consent).

**Slots:**
- `video`: Your custom `<video>` element.
- `button`: Custom capture button.
- `loading`, `success`, `error-no-face`, `error-multiple-faces`, `error-not-centered`, `error-other`: Custom UI messages for different states.

**Basic Usage**
```html
<biometry-enrollment
  endpoint="your-endpoint-link"
  user-fullname="John Doe">
</biometry-enrollment>
```

**Advanced Usage**
```html
<biometry-enrollment
  endpoint="your-endpoint-link"
  user-fullname="John Doe">
  
  <video slot="video" autoplay playsinline style="width: 100%; border-radius: 10px;"></video>
  <button slot="button" style="padding: 10px 20px; font-size: 16px;">Capture</button>
  
  <!-- Custom Status Messages -->
  <div slot="loading">Please wait while we process your photo...</div>
  <div slot="success">Congratulations! You have been enrolled.</div>
  <div slot="error-no-face">No face detected. Make sure your face is visible.</div>
  <div slot="error-multiple-faces">Multiple faces detected. Please try again alone.</div>
  <div slot="error-not-centered">Align your face with the center of the screen.</div>
  <div slot="error-other">Oops! Something went wrong. Please try again.</div>
</biometry-enrollment>
```

### Process Video Component
The **Process Video** component enables you to record, upload, and process a video within your application. It integrates with Biometry's services to check liveness and authorize the user.

### Usage
**Basic Usage**
```html
<process-video
  endpoint="your-endpoint-link"
  user-fullname="John Doe"
></process-video>
```

**Advanced Usage**
```html
<process-video
  endpoint="your-endpoint-link"
  user-fullname="John Doe"
>
  <!-- Custom video element -->
  <video slot="video" muted playsinline style="border-radius: 1rem;"></video>

  <!-- Custom buttons -->
  <button slot="record-button">Custom Record</button>
  <button slot="stop-button">Custom Stop</button>
  
  <!-- Custom file input -->
  <input slot="file-input" type="file" accept="video/*" />

  <!-- Custom submit button -->
  <button slot="submit-button">Custom Submit</button>

  <!-- Custom messages -->
  <div slot="loading">Processing...</div>
  <div slot="error">An error occurred. Please try again.</div>
  <div slot="success">Video submitted successfully!</div>
</process-video>
```
**Note:**
- All default elements and messages are functional out-of-the-box.
- Replace slots if you want to customize the UI or functionality.
- Call giveConsent() before using any biometric methods to ensure compliance with data processing requirements.
   
## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more details.

## More Information
For more detailed information on Biometry’s API endpoints, parameters, and responses, visit the official [Biometry API Documentation](https://developer.biometrysolutions.com/overview/). If you have questions or need help, please reach out to our support team or create a GitHub issue.

- **UI Components:**
  - `<biometry-enrollment ...>` (face enrollment)
  - `<process-video ...>` (video enrollment)
With these **direct SDK methods**, **UI components**, and advanced **best practices** (faceEnroll + faceMatch flows, reuse of video, error handling), you can build robust, privacy-conscious biometric solutions on your web application.

### ID Document Scan Component
The **ID Document Scan** component allows users to scan and upload an ID document using their camera. It is designed to be simple, secure, and easy to integrate into your application.

#### Description
This component provides a rectangular scanning area using the user's camera, a button to capture the document, and uploads a high-quality JPEG image to your backend endpoint. The backend should process the image using the Biometry SDK and your API key (never expose your API key to the client).

#### Required attributes:
- `endpoint`: The URL of your endpoint that will process the [document authentication](https://developer.biometrysolutions.com/api/doc-auth/). All captured data will be sent to this endpoint for secure processing.
- `user-fullname`: The user’s full name (used in data storage and consent).

#### Slots:
- (No custom slots are required, but you can style the component using CSS variables.)

#### Basic Usage
```html
<id-document-scan
  endpoint="your-endpoint-link"
  user-fullname="John Doe"
></id-document-scan>
```

#### Customization
You can override the default styles using CSS custom properties. For example:
```css
id-document-scan {
  --primary-color: #4caf50;
  --scan-area-border: 2px solid #4caf50;
}
```
Here is the list of available CSS variables:
```css
--primary-color: #007bff;
--button-bg: var(--primary-color);
--button-text-color: #fff;
--border-radius: 8px;
--scan-area-border: 2px dashed var(--primary-color);
--scan-area-bg: rgba(0, 123, 255, 0.05);
--button-padding: 10px 24px;
--button-radius: 6px;
--button-hover-bg: #0056b3;
```
  
