# biometry-sdk

## Overview
The **Biometry Web SDK** is a software development kit designed to simplify the integration of Biometry's API services into your web application. Providing tools, UI components, and utilities enables biometric onboarding (face and voice), liveness checks, and user consent.


## Features
- **Consent Management**:
  - Ask a permission to store their biometric data for authentication using Biometry.
  - Collect user permission to store their biometric data for authentication using Biometry.
  - Important: You must obtain consent before performing any onboarding or video processing.
- **Voice onboarding**:
  - Enroll a user’s voice, creating a voice model for future authentication.
- **Face onboarding**: Onboard face for face recognition.
  - Onboard a user’s face for facial recognition.
  - **Face Onboarding UI Component:** A ready-to-use, customizable component for capturing and processing face data.
- **Face match**:
  - Compares an extracted image from a user’s personal document to an image frame captured during onboarding or  `/process-video.`
- **Process video**:
  - Checks user liveness and authorizes users based on video input.
  - **Process Video UI Component:** A ready-to-use, customizable component for capturing and processing video.


## Installation
```bash
npm install biometry-sdk
```

## Usage
```typescript
import { BiometrySDK } from 'biometry-sdk';

const sdk = new BiometrySDK('put your API key here');

const videoFile = new File([/* file parts */], "video.mp4", {type: "video/mp4"});
const phrase = "one two three four five six";
const userFullName = "John Doe";

const response = await sdk.processVideo(videoFile, phrase, userFullName);
console.log(response);
```

## Example

You can find an example in the example/ directory. The example demonstrates how you might integrate the BiometrySDK in a React component with the state. 
## UI Components
The Biometry Web SDK includes reusable, customizable web components for crucial features. These components are easy to embed into your application and handle the most common biometric operations with minimal setup.

### Face Onboarding Component
This component provides an intuitive interface for onboarding users with their cameras. It integrates directly with the `BiometrySDK backend`, managing camera capture, consent checks, and error handling.

### Integration
Here's how to integrate the `Face Onboarding` component into your application:

**Option 1: Using npm (Recommended for full SDK usage)**
1. Install the SDK package via **npm**:
    ```bash
    npm install biometry-sdk
    ```
2. Import the component in your **index.js** or equivalent JavaScript file:
    ```javascript
    // index.js
    import './node_modules/biometry-sdk/dist/components/biometry-onboarding.js';
    ```
3. Connect the script to your **HTML file** and use the component:
    ```html
    <script type="module" src="./index.js"></script>
    ```


**Option 2: Using CDN (Quick Integration)**
```html
<script type="module" src="https://cdn.jsdelivr.net/npm/biometry-sdk/dist/components/biometry-onboarding.js"></script>
```

### Usage
**Required attributes:**
- `api-key`: Your Biometry API key.
- `user-fullname`: The user’s full name (used in data storage and consent).

**Slots:**
- `video`: Your custom <video> element.
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
  user-fullname="Jane Doe">
  
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
    import './node_modules/biometry-sdk/dist/components/process-video.js'
    ```
3. Include the component in your HTML:
   You can skip the npm installation and include the component directly in your HTML:
   ```html
    <script type="module" src="./index.js"></script>
    <process-video ...></process-video>
   ```
**Option 2: Using CDN (Quick Integration)**
```html
<script type="module" src="https://cdn.jsdelivr.net/npm/biometry-sdk/dist/components/process-video.js"></script>
<process-video ...></process-video>
```
### Usage
**Basic Usage**
```html
<process-video
  api-key="your-api-key"
  user-fullname="Lionel Messi"
></process-video>
```

**Advanced Usage**
```html
<process-video
  api-key="eyJhb...apikey"
  user-fullname="John Doe Uulu"
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

## Best Practices
1. **Always Acquire Consent**
   - Before performing Face Onboarding or Process Video, you can call:
     ```javascript
      sdk.giveConsent(true, userFullName);
     ```
   - Or directly send a request to the `/consent` in the [official documentation](https://developer.biometrysolutions.com/overview/).
   
   This ensures legal compliance and user awareness when storing and processing biometric data.
3. **Handle Errors Gracefully**
   - The SDK methods throw errors if something goes wrong (e.g., network, permission, or detection errors). Use try/catch or .catch() to handle them.
4. **Security**
   - Protect your API key. Avoid exposing it in public repositories or client-side code if possible.
   
## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more details.

## More Information
For more detailed information on Biometry’s API endpoints, parameters, and responses, visit the official [Biometry API Documentation](https://developer.biometrysolutions.com/overview/). If you have questions or need help, please reach out to our support team or create a GitHub issue.

## Quick Reference
- Install: `npm install biometry-sdk`
- Consent: `sdk.giveConsent(true, userFullName)` (Required before onboarding/processing)
- Voice Onboarding: `sdk.enrollVoice(file, userFullName)`
- Face Onboarding: `sdk.enrollFace(file, userFullName)`
- Process Video: `sdk.processVideo(file, phrase, userFullName)`
