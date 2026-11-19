# Changelog

## 3.1.0 (BM-527)

Proxy mode: the SDK can call your own backend instead of the Biometry API, so the browser never holds your project API key.

### Added

- `new BiometrySDK(options)` with `apiKey`, `baseUrl`, `headers`, `credentials` and `paths`. `new BiometrySDK('key')` still works and is the same as `{ apiKey: 'key' }`.
- With `baseUrl`, each call goes to `baseUrl` plus its proxy path: the API v2 path without the `/api-gateway/v2` prefix (`/sessions`, `/sessions/{session_id}/end`, `/liveness`, `/face-verify`, `/voice-verify`, `/face-match`, `/enrollments/face`, `/enrollments/voice`, `/documents/check`). Your backend names its own routes; it does not have to mirror Biometry's service names.
- `paths` overrides the proxy path of single calls, keyed by `ProxyOperation` (`startSession`, `endSession`, `liveness`, `faceVerify`, `voiceVerify`, `faceMatch`, `enrollFace`, `enrollVoice`, `checkDocument`). The defaults are exported as `DEFAULT_PROXY_PATHS`. An override must start with `/`, contain no `?` or `#`, and contain exactly the placeholders of the default (`{session_id}` for `endSession`); placeholder values are URI-encoded. Invalid overrides and unknown keys throw in the constructor.
- `giveAuthorizationConsent` and `giveStorageConsent` throw in proxy mode: your backend records consent.
- `apiKey` is optional when `baseUrl` is set. Without an API key the SDK sends no `Authorization` header.
- `baseUrl` must be an absolute `http` or `https` URL with no `?` or `#` at all, otherwise the constructor throws.
- `headers` (an object, or a function called before every request) adds your own headers, for example your app's session token for the proxy. They replace SDK headers with the same name, compared case-insensitively, except `Content-Type`, which the SDK always sets from the body.
- Options with neither `apiKey` nor `baseUrl` throw `apiKey or baseUrl is required to initialize the SDK.`
- `credentials` is passed to `fetch`, for cross-origin proxies that use cookies.
- `headers`, `credentials` and `paths` only apply with `baseUrl`. In direct mode they are ignored and the constructor logs a `console.warn`, so direct calls to Biometry carry only the API key.
- `baseUrl` is trimmed of surrounding whitespace, and trailing slashes are removed without a regex (no polynomial backtracking on long inputs).
- `examples/proxy-server`: a zero-dependency Node proxy (with a `node --test` suite) that authenticates the caller, accepts only the SDK's default proxy paths (forwarding each to Biometry under `/api-gateway/v2`), rebuilds every request from an allow list with `user_id` set to the signed-in user, refuses foreign `session_id`s, drops the query string, and adds the API key. It also records consent server-side (`recordConsent()`, `POST /onboarding/consent`, through `PUT /api-gateway/v2/users/{user_id}/consents`) instead of forwarding the SDK's consent calls, and owns the liveness challenge (`POST /challenge` for a session; the stored challenge is written into `phrase` on liveness and voice-verify, each once per session; face-verify needs none). `authenticate` is required (the demo token only runs with `ALLOW_DEMO_AUTH=1`), session ownership expires and is dropped on session end, and session starts and challenges are rate-limited per user.
- `examples/proxy-server`: a challenge use counts only after Biometry answers 2xx. The route is reserved while the call is in flight (a concurrent double submit gets 409) and released on any other status or a network error, so a retry can reuse the digits. CORS `access-control-allow-headers` is derived from the preflight's requested headers, filtered against an allow list that `allowedHeaders` / `ALLOWED_HEADERS` extends. `trustProxy` / `TRUST_PROXY` picks the client IP from `x-forwarded-for` behind load balancers. A sweep every minute drops expired sessions, challenges and rate-limit windows.
- `examples/proxy-server` review fixes: Biometry calls time out after `upstreamTimeoutMs` (default 120 s, `504`); `/challenge` and `/onboarding/consent` need `content-type: application/json`, and browser requests from an origin other than `allowedOrigin` or the proxy's own host get `403`, so another site cannot use a signed-in user's cookies; liveness requests may not exclude `active_speaker_detection` or `visual_speech_recognition` (the challenge checks); store methods may return Promises; `trustProxy` falls back to the socket address when `x-forwarded-for` has fewer entries than trusted proxies or the entry is not an IP; consent response bodies are released; Node 18.8 or newer.

- `faceVerify` and `voiceVerify` take `props.useSessionVideo`: with a `sessionId`, the gateway reuses the video the session's liveness check stored, and the file argument may be `null` (it is not sent). In a session, face and voice must use the liveness media (the same file or `useSessionVideo`); other media gets `400 media_mismatch` once the gateway enforces media binding (BM-535).
- `examples/proxy-server`: face-verify and voice-verify accept `use_session_video`. The README notes that a failed liveness check still answers `200` and so uses up the challenge; issue a new one to retry.

### Changed

- `faceVerify` phrase is optional; the API no longer needs it. The signature is now `faceVerify(video, userId, phrase?, props?)`, so existing calls that pass a phrase still work. The phrase goes into the request only when it is a non-empty string; pass `undefined` to skip it and still give `props`. User ID is still required, and a video unless `useSessionVideo` is set.

### Requires

- The example proxy needs biometry-api-gateway #147 (phrase optional on v2 face-verify; the proxy sends face-verify without a phrase) and #148 (`PUT /api-gateway/v2/users/{user_id}/consents`) deployed, in that order, before it works end to end. The SDK itself needs neither, except that calling `faceVerify` without a phrase directly against the API also needs #147.

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
