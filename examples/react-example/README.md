# React example

A React + TypeScript + Vite page that walks through the SDK's API v2 surface, one step per section.

The API key is entered in the browser here to keep the example self-contained. **Do not do this in
production** — a key in client code is a key you have published. Put the SDK behind a server you
control, as the [plain HTML example](../html-example) does.

## Run it

```bash
npm install
npm run dev
```

## The flow

1. **Initialize** — `new BiometrySDK(apiKey)`.
2. **Identify** — biometric calls take an opaque `userId` you choose and control. Consent is
   separate and still identifies the user by full name.
3. **Session** (optional) — `startSession()` / `endSession()`. Passing the session id to later
   calls lets the backend score them together.
4. **Consent** — `giveAuthorizationConsent()` and `giveStorageConsent()`, served by the consent
   service rather than the gateway.
5. **Enroll** — `enrollFace(face, userId, { isDocument })`.
6. **Verify** — `liveness()` checks the capture is live; `faceVerify()` and `voiceVerify()` also
   match it against the enrolled user. In v1 these were one `processVideo()` call.
7. **Document** — `checkDocAuth(document, { provider, sessionId })`.

Failures arrive as `BiometryApiError`, carrying the gateway's `status`, `code` and `meta`. The
example renders that rather than stringifying the object.
