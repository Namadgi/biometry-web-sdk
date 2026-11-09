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

In proxy mode the web SDK methods still take a `userId` and a `phrase`. Pass your backend's
id for the signed-in user as `userId` (the same value `authenticate()` returns; the proxy sets
`user_id` from the session anyway), and pass the challenge the app displayed as `phrase` on
`liveness()` and `voiceVerify()`. The proxy overwrites the phrase with its stored copy, but the
SDK still requires a non-empty value.

```ts
const sessionId = (await sdk.startSession()).body.data.session_id;
const res = await fetch('http://localhost:3002/challenge', {
  method: 'POST',
  headers: { Authorization: `Bearer ${yourAppSessionToken}`, 'content-type': 'application/json' },
  body: JSON.stringify({ session_id: sessionId }),
});
const { challenge } = await res.json();
showDigits(challenge); // the user reads these on camera
await sdk.liveness(video, currentUser.id, challenge, { sessionId });
```

```dart
// Flutter
final biometry = await Biometry.initialize(
  baseUrl: 'http://10.0.2.2:3002', // Android emulator address for the host machine
  userId: 'user-123',
  headersProvider: () async => {'Authorization': 'Bearer ${await auth.token()}'},
);
```

## Gateway versions it needs

Merge and deploy order: **biometry-api-gateway #147, then #148, then this example.**

- **Consent** goes through `PUT /api-gateway/v2/users/{user_id}/consents`, added by
  biometry-api-gateway PR #148 (BM-520). Until that is deployed, `POST /onboarding/consent`
  answers `502` (Biometry answers `404`).
- **face-verify** is sent **without a phrase**. That is only accepted once biometry-api-gateway
  PR #147 is deployed, which makes `phrase` optional on v2 face-verify. The gateway currently on
  `main` still requires it, so face-verify through this proxy fails with a `400` until then.

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
   the SDKs' own consent calls (`/api-consent/*` and `/api-gateway/v2/users/{user_id}/consents`).
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

Face and voice enrollment need the user's **authorization consent** (Biometry may process their
biometric data) and **storage consent** (Biometry may store it). Your backend records both,
server-to-server with your API key, in one call:

```
PUT /api-gateway/v2/users/{user_id}/consents   {"authorization": true, "storage": true}
```

`false` withdraws a consent, and `GET` on the same path returns both states. Your user ids must
be **3 to 128 characters** of `A-Za-z0-9._:@-`. The SDKs' own consent calls are not forwarded,
so a device can never record consent for someone else.

This example does it in `recordConsent({ apiUrl, apiKey, userId, clientHeaders, signal })`, exposed as:

```
POST /onboarding/consent      {"accepted": true}      -> records both for the signed-in user
```

It needs `content-type: application/json`, and answers `400` for a user id outside 3 to 128 characters and `502` if Biometry refuses. It
passes the user's `user-agent` and IP on, so Biometry's record of the consent shows the user's
client rather than this server. Call it
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
- a use only counts once Biometry answers `2xx`. The route is reserved while the call is in
  flight, so a concurrent double submit gets `409`, and released if Biometry answers anything
  else or cannot be reached, so the user can retry with the same digits;
- on those calls the proxy writes the challenge into `request.phrase` and pins `vocabulary` to
  `en_digits`, ignoring whatever the device sent;
- **face-verify** needs no challenge: the gateway runs face recognition only there, which
  ignores the phrase, so the proxy sends none (needs gateway #147, see above);
- at most 10 issued per user per minute (`429` with `Retry-After`).

- on liveness, `services` may not exclude (or leave out of `include`) `active_speaker_detection` or
  `visual_speech_recognition`, the services that check the spoken challenge (`400`).

The store is an in-memory `Map`. In production use shared storage with atomic updates, for
example a Redis hash per user and session with `EXPIRE 300`: reserve a route with
`HSETNX <key> <route> pending`, mark it used with `HSET <key> <route> used` after a `2xx`, and
`HDEL` it if the call failed.

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
| `ALLOWED_HEADERS` | (unset) | Comma-separated extra request headers the page may send cross-origin, for example `x-csrf-token`. Added to `authorization, content-type, x-client-app, x-client-app-version`. |
| `TRUST_PROXY` | `0` | How many proxies or load balancers in front of this server append to `x-forwarded-for`. `0` uses the socket address. Above `0`, the same-origin check also reads the scheme from `x-forwarded-proto`, which a TLS-terminating load balancer sets. |
| `UPSTREAM_TIMEOUT_MS` | `120000` | How long a Biometry call may take before the proxy answers `504`. Keep it above your slowest call. |

**Other origins.** Browser requests whose `Origin` is neither `ALLOWED_ORIGIN` nor this server's
own origin (same scheme and host, so `http://` does not match an `https://` server) get `403`, and `/challenge` and `/onboarding/consent` need
`content-type: application/json`. That stops another site from making a signed-in user's browser
call the proxy with their cookies (a form or `text/plain` POST needs no CORS preflight). Requests
without `Origin` (native apps, server-to-server) are allowed. If a reverse proxy in front rewrites
`Host`, set `ALLOWED_ORIGIN` to your page's origin.

**Shared storage.** `sessions` and `challenges` are objects with the methods of `SessionStore` and
`ChallengeStore` (`owner`, `allowStart`, `add`, `delete`, `issue`, `reserve` returning
`{ value, commit, release }`, `deleteSession`). Each may return a Promise, so a Redis-backed store
works; make `reserve` atomic (for example `HSETNX`).

**CORS headers.** A preflight gets back only the headers it asked for
(`Access-Control-Request-Headers`) that are on the allow list (`CORS_ALLOWED_HEADERS` plus
`allowedHeaders` / `ALLOWED_HEADERS`). If your app sends its own auth header through the SDK's
`headers` option, add it there. These headers only reach this server; they are not forwarded to
Biometry.

**Behind a load balancer.** The client IP passed into the consent record is the socket address,
which behind a load balancer is the load balancer. Set `trustProxy` (or `TRUST_PROXY`) to the
number of proxies that append to `x-forwarded-for`, and the proxy uses the address the outermost
one saw. Leave it at `0` when nothing is in front: clients can write `x-forwarded-for` themselves.

**Memory.** Sessions, challenges and rate-limit windows live in `Map`s. Expired entries are
dropped when read and by a sweep every minute (`sweepIntervalMs`, `0` turns it off). With shared
storage, expiry does this for you.

In your own code, import it and pass your auth:

```js
import { createProxy } from './server.mjs';

createProxy({
  apiKey: process.env.BIOMETRY_API_KEY,
  authenticate: (req) => yourSessionUserId(req), // user_id or undefined
}).listen(3002);
```

`server.mjs` also exports `ROUTES`, `recordConsent`, `SessionStore`, `ChallengeStore`,
`generateChallenge`, `clientAddress`, `CORS_ALLOWED_HEADERS`, `CHALLENGE_SERVICES`, `CHALLENGE_LENGTH`,
`CHALLENGE_DIGITS` and `CHALLENGE_VOCABULARY`.

Before production, keep sessions and challenges in shared storage instead of memory, add rate
limits to the other routes, and serve it over HTTPS.
