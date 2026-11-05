# Backend proxy example (proxy mode)

A zero-dependency Node server that lets a browser or mobile app use the Biometry SDKs without
holding your Biometry API token. It is also the reference for two things that must happen on
your backend: recording the user's consent, and owning the liveness challenge.

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
  headersProvider: () async => {'Authorization': 'Bearer ${await auth.token()}'},
);
```

## What it does

1. Authenticates the caller as one of **your** users (`authenticate()`; the demo maps the bearer
   token `demo-app-token` to `user-123`).
2. Accepts only the paths the SDKs call: `POST /api-gateway/v2/sessions`,
   `POST /api-gateway/v2/sessions/{id}/end`, the multipart calls (`liveness`, `face-verify`,
   `voice-verify`, `face-match`, `enrollments/face`, `enrollments/voice`, `documents/check`,
   `deepfake/checks`), and the consent-template calls
   `POST /api-gateway/v2/consents/{id}/approve/{user_id}` and
   `GET /api-gateway/v2/consents/my-approvals/{user_id}`. Anything else gets `404`, including
   the SDKs' own `/api-consent/*` calls.
3. **Never passes the client's body through.** It parses the JSON `request` part, builds a new
   one from the fields that route allows (exact key names only), **sets** `user_id` to the
   signed-in user, keeps `session_id` only if this server started that session for the same
   user (otherwise `403`), and rebuilds the multipart body with only the expected file parts.
   Comparing `user_id` and forwarding the original body is not enough: the gateway's JSON decoder
   matches keys case-insensitively, so `{"user_id":"me","USER_ID":"victim"}` would act as
   `victim`.
4. **Owns the liveness challenge** (see below): liveness, face-verify and voice-verify always
   send the challenge this server issued, never the device's phrase.
5. Drops the query string (only `warmup=true` on session start is kept), because the gateway
   reads form values from the query too.
6. Adds `Authorization: Bearer $BIOMETRY_API_KEY`, drops the caller's own `Authorization` and
   cookies, and returns Biometry's status, body and safe headers (`content-type`,
   `x-request-id`, `retry-after`, rate-limit headers).

A `user_id` in the path (consent-template calls) must equal the signed-in user, otherwise `403`.

## Consent (required before enrollment)

Biometry needs the user's **authorization consent** (for face and voice verification) and
**storage consent** (for enrollment). Your backend records both, server-to-server with your API
key, through `/api-consent/consent` and `/api-consent/strg-consent`, using your `user_id` as
`user_fullname`. The SDKs' `giveAuthorizationConsent` / `giveStorageConsent` calls are not
forwarded, so a device can never record consent for someone else.

This example does it in `recordConsent(userId)`, exposed as:

```
POST /onboarding/consent      {"accepted": true}      -> records both for the signed-in user
```

Call it from your onboarding flow once the user has agreed in your app, before the first
enrollment. The `/v2/consents` endpoints (`approveConsent` / `getConsentApprovals` in the
Flutter SDK) are a different feature: your own custom consent documents. They do **not** unlock
enrollment or verification. Remove those two routes from `ROUTES` if you don't use them.

## Liveness challenge

```
POST /challenge   -> {"challenge": "48719352", "expires_in": 300}
```

The app shows the digits and the user reads them on camera. The server keeps its own copy,
keyed by the signed-in user (never by an id the client sends):

- generated with `crypto.randomInt`: `CHALLENGE_LENGTH` (8) distinct digits from
  `CHALLENGE_DIGITS` (`1`-`9`), both set at the top of `server.mjs`;
- one outstanding challenge per user (a new one replaces the old), expires after 5 minutes;
- at most 10 issued per user per minute (`429` with `Retry-After` after that);
- taken and deleted by the next liveness, face-verify or voice-verify call, whatever its result,
  and written into `request.phrase`. With no valid challenge the call gets `409` and nothing is
  sent to Biometry.

The store is an in-memory `Map`. In production use shared storage with an atomic take, for
example Redis `SET key value EX 300` to issue and `GETDEL key` (Redis 6.2+) to use.

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

`server.mjs` also exports `createProxy({ apiKey, apiUrl, authenticate, allowedOrigin, sessionOwners, challenges })`,
`ROUTES`, `recordConsent`, `ChallengeStore`, `generateChallenge`, `CHALLENGE_LENGTH` and
`CHALLENGE_DIGITS`, if you want to reuse them in your own code.

Before production, replace `authenticate()` with your real session or JWT check, keep sessions
and challenges in shared storage instead of memory, add rate limits to the other routes, and
serve it over HTTPS.
