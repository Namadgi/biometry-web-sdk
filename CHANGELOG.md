# Changelog

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
