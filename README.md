# biometry-web-sdk

## Overview
The `biometry-web-sdk` is a software development kit (SDK) designed to facilitate the integration of Biometry's API services.

## Features
- Consent management (For storing facial and audio biometric data)
- Voice onboarding
- Face onboarding
- Face match
- Process video

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
