# biometry-sdk

## Overview
The **Biometry Web SDK** is a software development kit designed to simplify the integration of Biometry's API services into your web application. Providing tools, UI components, and utilities enables biometric onboarding (face and voice), liveness checks, and user consent.

## Table of Contents:
- [Installation](#installation)
- [Basic Usage (Direct SDK Methods)](#basic-usage-direct-sdk-methods)
  - [Consent](#1-give-consent)
  - [Face Onboarding](#2-face-onboarding)
  - [Voice Onboarding](#3-voice-onboarding)
  - [Process Video](#4-process-video)
- [Advanced Usage And Best Practices](#advanced-usage-and-best-practices)
  - [Typical FaceMatch Flow](#typical-facematch-flow)
  - [Use Cases with processVideoRequestId and usePrefilledVideo](#use-cases-with-processVideoRequestId-and-usePrefilledVideo)
  - [Error Handling](#error-handling)
  - [Security And Privacy Considerations](#security-and-privacy-considerations)
- [UI Components](#ui-components)
  - [Face Onboarding Component](#face-onboarding-component)
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

### 1. Give Consent
You **must** obtain user consent before performing any biometric operations:
  ```javascript
  await sdk.giveConsent(true, 'John Doe');
  // or
  sdk.giveConsent(true, 'John Doe').then(() => {
    console.log('Consent given');
  });
  ```
- The first argument (`true`) indicates that the user has granted consent.
- The second argument is the user’s full name (used for record-keeping within Biometry).

### 2. Face Onboarding
Onboard a user’s face for future recognition or matching:
  ```javascript
  const faceFile = new File([/* face image bytes */], 'face.jpg', { type: 'image/jpeg' });
  
  // Onboard face
  const faceResponse = await sdk.onboardFace(faceFile, 'John Doe');
  console.log('Face Onboarding Response:', faceResponse);
  ```

### 3. Voice Onboarding
Enroll a user’s voice for future authentication checks:
  ```javascript
  const voiceFile = new File([/* voice audio bytes */], 'voice.wav', { type: 'audio/wav' });

  await sdk.giveConsent(true, 'John Doe');
  const voiceResponse = await sdk.onboardVoice(voiceFile, 'John Doe');
  console.log('Voice Onboarding Response:', voiceResponse);
  ```
### 4. Process Video
Process a user’s video for liveness checks and identity authorization:
  ```javascript
  const videoFile = new File([/* file parts */], 'video.mp4', { type: 'video/mp4' });
  const phrase = "one two three four five six";
  const userFullName = 'John Doe';
  
  await sdk.giveConsent(true, userFullName);
  
  try {
    const response = await sdk.processVideo(videoFile, phrase, userFullName);
    console.log('Process Video Response:', response);
  
    // The response headers or body may include a processVideoRequestId (for reuse).
    const { requestId: processVideoRequestId } = response;
  } catch (error) {
    console.error('Error processing video:', error);
  }
  ```
## Advanced Usage And Best Practices
### Typical FaceMatch Flow
One common advanced scenario involves document authentication in onboarding face and face matching:
1. Face Onboarding: Capture the user’s live face or the user uploads a picture of their identity document (front side with the face)
2. Process Video: Capture the user’s live face
3. Face Match: Compare the extracted face from the document with the user’s live face to verify identity.

Below is a possible flow (method names in your SDK may vary slightly depending on your integration setup):
  ```javascript
  // 1. Acquire user consent
  await sdk.giveConsent(true, userFullName);
  
  // 2. Onboard or capture the user’s face
  //    (Either using onboardFace or processVideo, depending on your user flow)
  const userFaceFile = new File([/* user selfie bytes */], 'image.jpg', { type: 'image/jpeg' });
  const userVideoFile = new File([/* user selfie bytes */], 'video.mp4', { type: 'video/*' });
  const onboardResponse = await sdk.onboardFace(userFaceFile, userFullName);
  
  // 3. Face Match (Compare video face with user’s onboarded face)
  const faceMatchResponse = await sdk.faceMatch(
    userFaceFile,
    userVideoFile,
    userFullName
  );
  
  // 4. Evaluate the faceMatch result
  if (faceMatchResponse.matchResult === 'match') {
    console.log('User video face matches user’s live face. Identity verified!');
  } else {
    console.log('User video face does NOT match. Additional verification needed.');
  }
  ```

### Use Cases with processVideoRequestId and usePrefilledVideo
- `processVideoRequestId`: After calling `sdk.processVideo()`, you typically receive a unique ID (`x-request-id`). You can pass this `processVideoRequestId` into subsequent calls (e.g., `faceMatch`) to reference the previously uploaded video frames.
- `usePrefilledVideo`: When set to `true`, indicates that the SDK should reuse the video already on file from a previous `processVideo` call rather than requiring a new upload.
Example:
  ```javascript
  const { x-request-id } = await sdk.processVideo(videoFile, phrase, userFullName);
  
  // Later on, we can reuse that video for face match or advanced checks
  const faceMatchResp = await sdk.faceMatch(null, null, userFullName, {
    processVideoRequestId: requestId,
    usePrefilledVideo: true
  });
  ```
Here, `faceMatch` might not require new face data if it can extract frames from the previously uploaded video.
### Error Handling
All SDK calls can throw errors for various reasons:
- Network/Connection Issues
- Invalid File Types
- No Face Detected (Face Onboarding)
- No Speech Detected (Voice Onboarding)
- Multiple Faces Detected (Face Onboarding)
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

### Face Onboarding Component
This component provides an intuitive interface for onboarding users with their cameras. It integrates directly with the `BiometrySDK backend`, managing camera capture, consent checks, and error handling.

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
3. Connect the script to your **HTML file** and use the component:
    ```html
    <script type="module" src="./index.js"></script>
    
    <biometry-onboarding
      api-key="your-api-key"
      user-fullname="John Doe">
    </biometry-onboarding>
    ```
    
**Option 2: Using CDN (Quick Integration)**
```html
<script type="module" src="https://cdn.jsdelivr.net/npm/biometry-sdk/dist/biometry-sdk.esm.js"></script>

<biometry-onboarding
  api-key="your-api-key"
  user-fullname="John Doe">
</biometry-onboarding>
```

### Usage
**Required attributes:**
- `api-key`: Your Biometry API key.
- `user-fullname`: The user’s full name (used in data storage and consent).

**Slots:**
- `video`: Your custom `<video>` element.
- `button`: Custom capture button.
- `loading`, `success`, `error-no-face`, `error-multiple-faces`, `error-not-centered`, `error-other`: Custom UI messages for different states.

**Basic Usage**
```html
<biometry-onboarding
  api-key="your-api-key"
  user-fullname="John Doe">
</biometry-onboarding>
```

**Advanced Usage**
```html
<biometry-onboarding
  api-key="your-api-key"
  user-fullname="John Doe">
  
  <video slot="video" autoplay playsinline style="width: 100%; border-radius: 10px;"></video>
  <button slot="button" style="padding: 10px 20px; font-size: 16px;">Capture</button>
  
  <!-- Custom Status Messages -->
  <div slot="loading">Please wait while we process your photo...</div>
  <div slot="success">Congratulations! You have been onboarded.</div>
  <div slot="error-no-face">No face detected. Make sure your face is visible.</div>
  <div slot="error-multiple-faces">Multiple faces detected. Please try again alone.</div>
  <div slot="error-not-centered">Align your face with the center of the screen.</div>
  <div slot="error-other">Oops! Something went wrong. Please try again.</div>
</biometry-onboarding>
```

### Process Video Component
The **Process Video** component enables you to record, upload, and process a video within your application. It integrates with Biometry's services to check liveness and authorize the user.

### Integration
**Option 1: Install via npm**
1. To include the component in your project, install the biometry-sdk package:
   ```bash
    npm install biometry-sdk
    ```
2. After installation, import the component into your project:
   ```javascript
    // index.js
    import './node_modules/biometry-sdk/dist/biometry-sdk.esm.js';
    ```
3. Include the component in your HTML:
   You can skip the npm installation and include the component directly in your HTML:
   ```html
    <script type="module" src="./index.js"></script>
    
    <process-video ...></process-video>
   ```
**Option 2: Using CDN (Quick Integration)**
```html
<script type="module" src="https://cdn.jsdelivr.net/npm/biometry-sdk/dist/biometry-sdk.esm.js"></script>

<process-video ...></process-video>
```
### Usage
**Basic Usage**
```html
<process-video
  api-key="your-api-key"
  user-fullname="John Doe"
></process-video>
```

**Advanced Usage**
```html
<process-video
  api-key="eyJhb...apikey"
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

## Quick Reference
- **Install**:
  ```bash
  npm install biometry-sdk
  ```
- **Consent**: (Required before onboarding/processing)
  ```javascript
  sdk.giveConsent(true, userFullName)
  ```
- **Voice Onboarding**:
  ```javascript
  sdk.onbaordVoice(file, userFullName)
  ```
- **Face Onboarding**:
  ```javascript
  sdk.onboardFace(file, userFullName)
  ```
- Face match
  ```javascript
  sdk.faceMatch(image, video, userFullName, { ...options });
  ```
- Process Video (basic):
  ```javascript
  sdk.processVideo(file, phrase, userFullName);
  ```
- Process Video (advanced w/ reusing video or linking IDs):
  ```javascript
  sdk.processVideo(null, phrase, userFullName, {
  usePrefilledVideo: true,
  processVideoRequestId: 'YOUR_REQUEST_ID',
  requestUserProvidedId: 'YOUR_CUSTOM_ID'
  });
  ```
- UI Components:
  - `<biometry-onboarding ...>` (face onboarding)
  - `<process-video ...>` (video onboarding)
With these **direct SDK methods**, **UI components**, and advanced **best practices** (faceOnboard + faceMatch flows, reuse of video, error handling), you can build robust, privacy-conscious biometric solutions on your web application.
  