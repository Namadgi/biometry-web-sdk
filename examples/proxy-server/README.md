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

1. Authenticates the caller as one of **your** users with the `authenticate(req)` you pass to
   `createProxy()`. It is required. Running `server.mjs` directly only works with
   `ALLOW_DEMO_AUTH=1`, which maps the bearer token `demo-app-token` to `user-123` (never use
   that in production).
2. Accepts only the paths the SDKs call: `POST /api-gateway/v2/sessions`,
   `POST /api-gateway/v2/sessions/{id}/end`, the multipart calls (`liveness`, `face-verify`,
   `voice-verify`, `face-match`, `enrollments/face`, `enrollments/voice`, `documents/check`,
   `deepfake/checks`), and the consent-template calls
   `POST /api-gateway/v2/consents/{id}/approve/{user_id}` and
   `GET /api-gateway/v2/consents/my-approvals/{user_id}`. Anything else gets `404`, including
   the SDKs' own `/api-consent/*` calls.
3. **Never passes the client's body through.** It parses the JSON `request` part, builds a new
   one from the fields that route allows (exact key names, checked types), **sets** `user_id` to
   the signed-in user, keeps `session_id` only if this server started that session for the same
   user (otherwise `403`), and rebuilds the multipart body with only the expected file parts
   (one file, or up to 4 `voice` recordings for voice enrollment). A non-multipart body on a
   multipart route gets `415`. Comparing `user_id` and forwarding the original body is not
   enough: the gateway's JSON decoder matches keys case-insensitively, so
   `{"user_id":"me","USER_ID":"victim"}` would act as `victim`.
4. **Owns the liveness challenge** (see below).
5. Drops the query string (only `warmup=true` on session start is kept), because the gateway
   reads form values from the query too, and forwards the path rebuilt from the checked ids.
6. Adds `Authorization: Bearer $BIOMETRY_API_KEY`, drops the caller's own `Authorization` and
   cookies, and returns Biometry's status, body and safe headers (`content-type`,
   `x-request-id`, `retry-after`, rate-limit headers).

Session ownership is kept for an hour, deleted when the session ends, and session starts are
limited to 20 per user per minute. Store ownership in shared storage with an expiry in
production (for example Redis `SET session:<id> <user_id> EX 3600`).

## Consent (required before enrollment)

Biometry needs the user's **authorization consent** (for face and voice verification) and
**storage consent** (for enrollment). Your backend records both, server-to-server with your API
key, through `/api-consent/consent` and `/api-consent/strg-consent`, using your `user_id` as
`user_fullname`. The consent service requires that value to be **at least 3 characters**, so
your user ids must be too. The SDKs' `giveAuthorizationConsent` / `giveStorageConsent` calls are
not forwarded, so a device can never record consent for someone else.

This example does it in `recordConsent(userId)`, exposed as:

```
POST /onboarding/consent      {"accepted": true}      -> records both for the signed-in user
```

It answers `400` for a user id shorter than 3 characters and `502` if Biometry refuses. Call it
from your onboarding flow once the user has agreed in your app, before the first enrollment.
The `/v2/consents` endpoints (`approveConsent` / `getConsentApprovals` in the Flutter SDK) are a
different feature: your own custom consent documents. They do **not** unlock enrollment or
verification. Remove those two routes from `ROUTES` if you don't use them.

## Liveness challenge

```
POST /challenge   {"session_id": "<a session this user started>"}
               -> {"challenge": "48719352", "expires_in": 300}
```

The app shows the digits and the user reads them on camera. In Flutter, pass them to
`Biometry.setChallenge(challenge)` (biometry 2.1.0) so the scanner shows the backend's digits,
and make sure the recording window (`scanTime`) covers 8 digits, about 10 seconds. The server
keeps its own copy, bound to the signed-in user **and** that session:

- generated with `crypto.randomInt`: `CHALLENGE_LENGTH` (8) distinct digits from
  `CHALLENGE_DIGITS` (`1`-`9`), both set at the top of `server.mjs`;
- valid for 5 minutes; a new challenge for the session replaces the old one;
- **liveness** and **voice-verify** can each use it once, so one recording can go to both; a
  second use on the same route, another session's challenge, or an expired one gets `409` and
  nothing is sent to Biometry. Both calls must send the `session_id`;
- on those calls the proxy writes the challenge into `request.phrase` and pins `vocabulary` to
  `en_digits`, ignoring whatever the device sent;
- **face-verify** needs no challenge: the gateway runs face recognition only there, which
  ignores the phrase, so the proxy sends none;
- at most 10 issued per user per minute (`429` with `Retry-After`).

The store is an in-memory `Map`. In production use shared storage with atomic updates, for
example a Redis key per user and session with `EXPIRE 300`, marking each route used with
`HSETNX`.

## Run it

```bash
ALLOW_DEMO_AUTH=1 BIOMETRY_API_KEY=your-key node server.mjs   # http://localhost:3002, demo auth
node --test                                                  # tests, no network needed
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `BIOMETRY_API_KEY` | (required) | Your project API token. Only this server sees it. |
| `ALLOW_DEMO_AUTH` | (unset) | Must be `1` to run the file directly with the demo token. |
| `BIOMETRY_API_URL` | `https://api.biometrysolutions.com` | Where requests are sent. |
| `PORT` | `3002` | Listen port. |
| `ALLOWED_ORIGIN` | (unset) | Your web app's exact origin, if it is served from another origin. Enables CORS with credentials, so cookies (`credentials: 'include'`) or an `Authorization` header both work. |

In your own code, import it and pass your auth:

```js
import { createProxy } from './server.mjs';

createProxy({
  apiKey: process.env.BIOMETRY_API_KEY,
  authenticate: (req) => yourSessionUserId(req), // user_id or undefined
}).listen(3002);
```

`server.mjs` also exports `ROUTES`, `recordConsent`, `SessionStore`, `ChallengeStore`,
`generateChallenge`, `CHALLENGE_LENGTH`, `CHALLENGE_DIGITS` and `CHALLENGE_VOCABULARY`.

Before production, keep sessions and challenges in shared storage instead of memory, add rate
limits to the other routes, and serve it over HTTPS.
