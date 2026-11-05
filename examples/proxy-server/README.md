# Backend proxy example (proxy mode)

A zero-dependency Node server that lets a browser or mobile app use the Biometry SDKs without
holding your Biometry API token.

The app points the SDK at this server and sends its own session token:

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
2. Accepts only the paths the SDKs call: `POST /api-gateway/v2/sessions`,
   `POST /api-gateway/v2/sessions/{id}/end`, the multipart calls (`liveness`, `face-verify`,
   `voice-verify`, `face-match`, `enrollments/face`, `enrollments/voice`, `documents/check`,
   `deepfake/checks`), `POST /api-gateway/v2/consents/{id}/approve/{user_id}` and
   `GET /api-gateway/v2/consents/my-approvals/{user_id}`. Anything else gets `404`.
3. **Never passes the client's body through.** It parses the JSON `request` part, builds a new
   one from the fields that route allows (exact key names only), **sets** `user_id` to the
   signed-in user, keeps `session_id` only if this server started that session for the same
   user (otherwise `403`), and rebuilds the multipart body with only the expected file parts.
   Comparing `user_id` and forwarding the original body is not enough: the gateway's JSON decoder
   matches keys case-insensitively, so `{"user_id":"me","USER_ID":"victim"}` would act as
   `victim`.
4. Drops the query string (only `warmup=true` on session start is kept), because the gateway
   reads form values from the query too.
5. Adds `Authorization: Bearer $BIOMETRY_API_KEY`, drops the caller's own `Authorization` and
   cookies, and returns Biometry's status, body and safe headers (`content-type`,
   `x-request-id`, `retry-after`, rate-limit headers).

A `user_id` in the path (consent calls) must equal the signed-in user, otherwise `403`.

The legacy consent-service calls of the web SDK (`giveAuthorizationConsent`,
`giveStorageConsent`, under `/api-consent/`) are not forwarded.

## Run it

```bash
BIOMETRY_API_KEY=your-key node server.mjs        # http://localhost:3002
node --test                                      # tests, no network needed
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `BIOMETRY_API_KEY` | (required) | Your project API token. Only this server sees it. |
| `BIOMETRY_API_URL` | `https://api.biometrysolutions.com` | Where requests are sent. |
| `PORT` | `3002` | Listen port. |
| `ALLOWED_ORIGIN` | (unset) | Your web app's exact origin, if it is served from another origin. Enables CORS with credentials, so cookies (`credentials: 'include'`) or an `Authorization` header both work. |

`server.mjs` also exports `createProxy({ apiKey, apiUrl, authenticate, allowedOrigin, sessionOwners })`
and the `ROUTES` table, if you want to mount it in your own code.

Before production, replace `authenticate()` with your real session or JWT check, keep the
session owners in real storage instead of memory, add rate limits, and serve it over HTTPS.
