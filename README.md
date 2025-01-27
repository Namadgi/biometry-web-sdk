# biometry-sdk

## Overview
The **Biometry Web SDK** is a software development kit (SDK) designed to facilitate the integration of Biometry's API services.

## Features
- **Consent management**: Ask a permission to store their biometric data for authentication using Biometry.
- **Voice onboarding**: Onboard voice for Voice Recognition.
- **Face onboarding**: Onboard face for face recognition.
  - Includes a customizable **Face Onboarding UI Component** for streamlined user interactions.
- **Face match**: Compares extracted image from user’s personal document with the frame from the `/process-video.`
- **Process video**: Process the video through Biometry services to check liveness and authorize user.
  - (UI Component for this feature coming soon)

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

You can find an example in the example/ directory. The example demonstrates how to integrate the SDK into a React app.

## UI Components
The **Biometry Web SDK** includes reusable and customizable web components for key features. These components make it simple to add biometric functionalities to your application.

### Face Onboarding Component
The `Face Onboarding` component provides an intuitive interface for onboarding users with their camera. It integrates with the `BiometrySDK` to handle backend communication and error states.

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
The `api-key` and `user-fullname` attributes are required for the component to function.

Custom slots allow you to style and customize UI elements, loading, success, and error states.

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
The Process Video component allows developers to record, upload, and process video directly within their applications through Biometry services to check liveness and authorize user.

### Integration
**Option 1: Install via npm**

1. To include the component in your project, install the biometry-sdk package:
```bash
npm install biometry-sdk
```

2. After installation, import the component into your project:
```javascript
// index.js
import './node_modules/biometry-sdk/dist/components/process-video.js';
```

3. Include the component in your HTML:
```html
<script type="module" src="./index.js"></script>
<process-video ...></process-video>
```

**Option 2: Import directly via CDN**

You can skip the npm installation and include the component directly in your HTML:
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

**Notes**
- By default, all elements are functional without customization. Replace slots only if customization is required.

- To regenerate the video preview or handle custom actions, use JavaScript to interact with the provided slots or the component's public methods.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more details.

## More Information

For more detailed documentation on the Biometry API, visit the [official documentation](https://developer.biometrysolutions.com/overview/).
