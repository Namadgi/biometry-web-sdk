# Backend proxy example (proxy mode)

A zero-dependency Node server that lets a browser or mobile app use the Biometry SDKs without
holding your Biometry API token.

The app points the SDK at this server:

```ts
// Web
const sdk = new BiometrySDK({
  baseUrl: 'http://localhost:3002',
  headers: () => ({ Authorization: `Bearer ${yourAppSessionToken}` }),
});
```

```dart
// Flutter
final biometry = await Biometry.initialize(
  baseUrl: 'http://10.0.2.2:3002', // Android emulator address for the host machine
  userId: 'user-123',
  headers: {'Authorization': 'Bearer $yourAppSessionToken'},
);
```

The server then:

1. Authenticates the caller as one of **your** users (`authenticate()`; the demo maps the bearer
   token `demo-app-token` to `user-123`).
2. Forwards only the paths the SDKs call: `POST /api-gateway/v2/sessions`,
   `POST /api-gateway/v2/sessions/{id}/end`, the multipart calls (`liveness`, `face-verify`,
   `voice-verify`, `face-match`, `enrollments/face`, `enrollments/voice`, `documents/check`,
   `deepfake/checks`), `POST /api-gateway/v2/consents/{id}/approve/{user_id}` and
   `GET /api-gateway/v2/consents/my-approvals/{user_id}`. Anything else gets `404`.
3. Refuses with `403` any `user_id` (in the JSON `request` part or the path) that is not the
   signed-in user, and any `session_id` this server did not start for that user.
4. Adds `Authorization: Bearer $BIOMETRY_API_KEY`, drops the caller's own `Authorization` and
   cookies, and forwards the request to Biometry with the same path and query.

The legacy consent-service calls of the web SDK (`giveAuthorizationConsent`,
`giveStorageConsent`, under `/api-consent/`) are not forwarded. Use the v2 consent endpoints.

## Run it

```bash
BIOMETRY_API_KEY=your-key node server.mjs        # http://localhost:3002
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `BIOMETRY_API_KEY` | (required) | Your project API token. Only this server sees it. |
| `BIOMETRY_API_URL` | `https://api.biometrysolutions.com` | Where requests are forwarded. |
| `PORT` | `3002` | Listen port. |
| `ALLOWED_ORIGIN` | (unset) | Your web app's origin, if it is served from another origin (enables CORS). |

Before production, replace `authenticate()` with your real session or JWT check, keep the
session owners in real storage instead of memory, and serve it over HTTPS.
