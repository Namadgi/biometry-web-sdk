# Changelog

## 3.1.0 (BM-527)

Proxy mode: the SDK can call your own backend instead of the Biometry API, so the browser never holds your project API key.

### Added

- `new BiometrySDK(options)` with `apiKey`, `baseUrl`, `headers` and `credentials`. `new BiometrySDK('key')` still works and is the same as `{ apiKey: 'key' }`.
- `baseUrl` replaces `https://api.biometrysolutions.com` and keeps every request path (`/api-gateway/v2/...`), so a backend proxy can forward requests unchanged.
- `apiKey` is optional when `baseUrl` is set. Without an API key the SDK sends no `Authorization` header.
- `baseUrl` must be an absolute `http` or `https` URL without a query or fragment, otherwise the constructor throws.
- `headers` (an object, or a function called before every request) adds your own headers, for example your app's session token for the proxy. They replace SDK headers with the same name, compared case-insensitively.
- Options with neither `apiKey` nor `baseUrl` throw `apiKey or baseUrl is required to initialize the SDK.`
- `credentials` is passed to `fetch`, for cross-origin proxies that use cookies.
- `examples/proxy-server`: a zero-dependency Node proxy (with a `node --test` suite) that authenticates the caller, accepts only the SDK's paths, rebuilds every request from an allow list with `user_id` set to the signed-in user, refuses foreign `session_id`s, drops the query string, and adds the API key.

### Unchanged

- Without `baseUrl`, requests go to the Biometry API with `Authorization: Bearer <apiKey>` exactly as in 3.0.0, and `new BiometrySDK('')` still throws `API Key is required to initialize the SDK.`

## 3.0.0 (BM-338)

Migrated the SDK to the **Biometry API v2** gateway (`/api-gateway/v2`). This is a breaking release.

### Breaking changes

- **Identity model:** biometric operations now take an opaque `userId` (sent in a JSON `request` multipart part) instead of `userFullName`/`X-User-Fullname`.
- **`processVideo` removed**, split into three operations: `liveness()`, `faceVerify()`, `voiceVerify()`.
- **`enrollFace(face, userId, { isDocument })`** — signature changed; `isDocument` moved into `props`.
- **`enrollVoice(audio, userId, phrase, { vocabulary })`** — signature changed; the redundant `uniqueId` parameter was removed.
- **`matchFaces(referenceImage, userId, { video, useSessionVideo, sessionId })`** — signature changed; the reference image and `userId` are now required, the live video moves into `props`.
- **`checkDocAuth(document, { provider, mrzProvider, sessionId })`** — `userFullName` removed; boolean `inHouseCheck`/`mrzValidation` replaced by `provider`/`mrzProvider` enums (`'inhouse' | 'idscan'`).
- **Session ID** is now at `response.body.data.session_id` (was `response.body.data`).
- **Response shape:** all gateway responses are the v2 success envelope (`{ data, decision?, meta }`).
- **Errors:** non-2xx gateway responses now throw `BiometryApiError` (exposes `status`, `code`, `meta`).
- `endSession` now targets `POST /api-gateway/v2/sessions/{id}/end`.

### Unchanged

- `giveAuthorizationConsent` / `giveStorageConsent` still call the dedicated consent service (`/api-consent/*`) and still identify the user by full name.
