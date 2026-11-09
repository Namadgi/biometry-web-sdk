// Minimal backend proxy for Biometry client SDKs ("proxy mode").
//
// The browser or mobile app holds no Biometry token. It points the SDK at this
// server (`new BiometrySDK({ baseUrl })` or `Biometry.initialize(baseUrl: ...)`),
// and this server:
//   1. authenticates the caller as one of YOUR users,
//   2. only accepts the Biometry paths the SDKs call,
//   3. never forwards the client's body: it rebuilds every request from an
//      allow list of fields and files, SETS user_id to the signed-in user, and
//      keeps a session_id only if this server started that session for them,
//   4. owns the liveness challenge: `POST /challenge` issues one for a session,
//      and liveness / voice-verify send that stored copy as `phrase`, whatever
//      the device sent,
//   5. adds `Authorization: Bearer <BIOMETRY_API_KEY>` and sends the rebuilt
//      request to the Biometry API.
//
// It also records the user's authorization and storage consent server-side
// (`POST /onboarding/consent`, `recordConsent()`); the SDKs' own consent
// calls are not forwarded.
//
// Zero dependencies, Node 18.8 or newer. Pass your own `authenticate()` and
// replace the in-memory stores (sessions, challenges) with shared storage
// before using it. Store methods may return Promises; the proxy awaits them.

import http from 'node:http';
import { randomInt } from 'node:crypto';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';

const MAX_BODY_BYTES = 50 * 1024 * 1024;

/** How long a Biometry call may take before the proxy gives up with 504. */
const UPSTREAM_TIMEOUT_MS = 120 * 1000;

/** Path parameters (session ids, consent ids, user ids) must look like ids. */
const SAFE_ID = /^(?!\.{1,2}$)[A-Za-z0-9._:@-]{1,128}$/;

/** Biometry consent is keyed by user_id, which must be 3 to 128 of these characters. */
const CONSENT_USER_ID = /^[A-Za-z0-9._:@-]{3,128}$/;

/** How long this proxy remembers which user started a session. */
const SESSION_TTL_MS = 60 * 60 * 1000;
/** Session starts allowed per user per minute. */
const SESSION_START_LIMIT = 20;

// ---------------------------------------------------------------------------
// Liveness challenge. The format lives here only: change these lines if you
// need a different length or alphabet.
// ---------------------------------------------------------------------------

/** Number of digits in a challenge. */
export const CHALLENGE_LENGTH = 8;
/** Digits a challenge is drawn from. 0 is left out: it has several spoken forms. */
export const CHALLENGE_DIGITS = '123456789';
/** Speech-recognition vocabulary for digit challenges, pinned on challenge routes. */
export const CHALLENGE_VOCABULARY = 'en_digits';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** Challenges issued per user per minute. */
const CHALLENGE_RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 1000;

/**
 * Returns CHALLENGE_LENGTH distinct digits from CHALLENGE_DIGITS, shuffled
 * with a CSPRNG (crypto.randomInt), for example "48719352".
 */
export function generateChallenge() {
  const digits = [...CHALLENGE_DIGITS];
  for (let i = digits.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [digits[i], digits[j]] = [digits[j], digits[i]];
  }
  return digits.slice(0, CHALLENGE_LENGTH).join('');
}

/** Fixed-window counter: at most `limit` calls per key per window. */
class RateLimiter {
  constructor(limit, windowMs, now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.windows = new Map(); // key -> { count, start }
  }

  allow(key) {
    const now = this.now();
    const w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      this.windows.set(key, { count: 1, start: now });
      return true;
    }
    if (w.count >= this.limit) return false;
    w.count += 1;
    return true;
  }

  /** Drops windows that have ended, so the map does not grow with every user ever seen. */
  sweep() {
    const now = this.now();
    for (const [key, w] of this.windows) {
      if (now - w.start >= this.windowMs) this.windows.delete(key);
    }
  }
}

/**
 * Which user started which Biometry session, with an expiry, and a per-user
 * limit on session starts.
 *
 * DEMO ONLY: in production store ownership in shared storage with an expiry
 * (for example Redis `SET session:<id> <user_id> EX 3600`).
 */
export class SessionStore {
  constructor({ now = Date.now, ttlMs = SESSION_TTL_MS } = {}) {
    this.now = now;
    this.ttlMs = ttlMs;
    this.owners = new Map(); // session_id -> { userId, expiresAt }
    this.starts = new RateLimiter(SESSION_START_LIMIT, RATE_WINDOW_MS, now);
  }

  allowStart(userId) {
    return this.starts.allow(userId);
  }

  add(sessionId, userId) {
    this.owners.set(sessionId, { userId, expiresAt: this.now() + this.ttlMs });
  }

  /** The user who started `sessionId`, or undefined if unknown or expired. */
  owner(sessionId) {
    const entry = this.owners.get(sessionId);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.owners.delete(sessionId);
      return undefined;
    }
    return entry.userId;
  }

  delete(sessionId) {
    this.owners.delete(sessionId);
  }

  /** Drops expired sessions and ended rate-limit windows. createProxy() calls it every minute. */
  sweep() {
    const now = this.now();
    for (const [id, entry] of this.owners) {
      if (entry.expiresAt <= now) this.owners.delete(id);
    }
    this.starts.sweep();
  }
}

/** Liveness services that check the spoken challenge. */
export const CHALLENGE_SERVICES = ['active_speaker_detection', 'visual_speech_recognition'];

/** Routes that consume the challenge. Each may use it once per session. */
const CHALLENGE_ROUTES = ['liveness', 'voice-verify'];

/**
 * Liveness challenges, bound to the signed-in user AND one session. Valid for
 * 5 minutes. Liveness and voice-verify can each use it once (so one recording
 * can go to both); a new challenge for the session replaces the old one.
 *
 * A route's use is two steps: `reserve()` before the Biometry call, then
 * `commit()` when Biometry answered 2xx, or `release()` when it did not (any
 * other status, or a network error), so a failed upstream call does not burn
 * the challenge. While a route is reserved, another request for it gets
 * nothing, so a double submit can't use one challenge twice.
 *
 * DEMO ONLY: in production keep this in shared storage, for example a Redis
 * hash per user+session with `EXPIRE 300`: reserve a route with an atomic
 * `HSETNX <key> <route> pending`, commit with `HSET <key> <route> used`, and
 * release with `HDEL <key> <route>` (only while it is still `pending`).
 */
export class ChallengeStore {
  constructor({ now = Date.now, generate = generateChallenge } = {}) {
    this.now = now;
    this.generate = generate;
    this.challenges = new Map(); // `${userId}\n${sessionId}` -> { value, expiresAt, used: Set, pending: Set }
    this.issued = new RateLimiter(CHALLENGE_RATE_LIMIT, RATE_WINDOW_MS, now);
  }

  /** Issues a new challenge for this user and session. Returns undefined when rate-limited. */
  issue(userId, sessionId) {
    if (!this.issued.allow(userId)) return undefined;
    const value = this.generate();
    this.challenges.set(`${userId}\n${sessionId}`, {
      value, expiresAt: this.now() + CHALLENGE_TTL_MS, used: new Set(), pending: new Set(),
    });
    return { value, expiresInSeconds: CHALLENGE_TTL_MS / 1000 };
  }

  /**
   * Reserves the challenge for `route`. Returns `{ value, commit, release }`,
   * or undefined if it is missing, expired, already used on that route, or
   * reserved by a request still in flight. Call `commit()` when Biometry
   * answered 2xx and `release()` otherwise; after the first of them, both do
   * nothing.
   */
  reserve(userId, sessionId, route) {
    const key = `${userId}\n${sessionId}`;
    const entry = this.challenges.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.challenges.delete(key);
      return undefined;
    }
    if (entry.used.has(route) || entry.pending.has(route)) return undefined;
    entry.pending.add(route);
    let settled = false;
    return {
      value: entry.value,
      commit: () => {
        if (settled) return;
        settled = true;
        entry.pending.delete(route);
        entry.used.add(route);
        // Only delete it if a newer challenge has not replaced it meanwhile.
        if (CHALLENGE_ROUTES.every((r) => entry.used.has(r)) && this.challenges.get(key) === entry) {
          this.challenges.delete(key);
        }
      },
      release: () => {
        if (settled) return;
        settled = true;
        entry.pending.delete(route);
      },
    };
  }

  /** Reserves and commits at once. Returns the challenge, or undefined like reserve(). */
  use(userId, sessionId, route) {
    const reservation = this.reserve(userId, sessionId, route);
    reservation?.commit();
    return reservation?.value;
  }

  deleteSession(userId, sessionId) {
    this.challenges.delete(`${userId}\n${sessionId}`);
  }

  /** Drops expired challenges and ended rate-limit windows. createProxy() calls it every minute. */
  sweep() {
    const now = this.now();
    for (const [key, entry] of this.challenges) {
      if (entry.expiresAt <= now) this.challenges.delete(key);
    }
    this.issued.sweep();
  }
}

// ---------------------------------------------------------------------------
// Consent. Biometry needs the user's authorization and storage consent before
// enrollment. Record both from your backend with your API key, through
// PUT /api-gateway/v2/users/{user_id}/consents, keyed by the same user_id.
// ---------------------------------------------------------------------------

/**
 * Records authorization and storage consent for `userId`. Call it from your
 * onboarding flow after the user agreed in your app, before enrollment.
 * Recording consent the user already gave is a no-op. `clientHeaders`
 * (the user's `user-agent`, `x-forwarded-for`) go into Biometry's record of
 * the consent instead of this server's.
 * Returns the failing Response (its body already released; read `status`),
 * or undefined when both were recorded. `signal` can abort the call.
 */
export async function recordConsent({ apiUrl, apiKey, userId, clientHeaders = {}, signal }) {
  if (typeof userId !== 'string' || !CONSENT_USER_ID.test(userId)) {
    throw new Error('user_id must be 3 to 128 characters of A-Za-z0-9._:@- for consent');
  }
  const headers = { ...clientHeaders, authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
  const res = await fetch(`${apiUrl}/api-gateway/v2/users/${encodeURIComponent(userId)}/consents`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ authorization: true, storage: true }),
    signal,
  });
  // Release the connection: only the status is used.
  await res.body?.cancel();
  return res.ok ? undefined : res;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Fields of the JSON `request` part a route may carry, with their type. Any
 * other key (including case variants such as `USER_ID`) is dropped. `user_id`
 * is never taken from the client: it is set from the signed-in user.
 */
const FIELD_TYPES = {
  session_id: 'string',
  phrase: 'string',
  vocabulary: 'string',
  trigger: 'string',
  use_session_video: 'boolean',
  is_document: 'boolean',
  provider: 'string',
  mrz_provider: 'string',
  services: 'services',
  phone_number: 'string',
};

function route(method, template, options) {
  const params = [...template.matchAll(/:(\w+)/g)].map((m) => m[1]);
  const pattern = new RegExp(`^${template.replace(/:(\w+)/g, '([^/]+)')}$`);
  return { method, template, params, pattern, ...options };
}

/**
 * The only calls the client SDKs make. Everything else gets 404.
 *
 * - `body`: 'none' (nothing is forwarded), 'json' or 'multipart' (rebuilt).
 * - `setUser`: add `user_id` = signed-in user to the rebuilt request part.
 * - `challenge`: this route's name for the challenge; `phrase` is set to the
 *   session's stored challenge and `vocabulary` to CHALLENGE_VOCABULARY.
 * - `fields`: request-part fields copied from the client.
 * - `files`: file parts copied from the client, with the most allowed of each.
 * - `query`: query parameters kept, with the only value allowed for each.
 */
export const ROUTES = [
  route('POST', '/api-gateway/v2/sessions', { body: 'none', startsSession: true, query: { warmup: 'true' } }),
  route('POST', '/api-gateway/v2/sessions/:session_id/end', { body: 'json', fields: ['phone_number'], endsSession: true }),
  route('POST', '/api-gateway/v2/liveness', {
    body: 'multipart', setUser: true, challenge: 'liveness',
    fields: ['session_id', 'trigger', 'services'], files: { video: 1 },
    // The services that check the spoken challenge. The client may not skip them.
    requiredServices: CHALLENGE_SERVICES,
  }),
  route('POST', '/api-gateway/v2/face-verify', {
    body: 'multipart', setUser: true, fields: ['session_id'], files: { video: 1 },
  }),
  route('POST', '/api-gateway/v2/voice-verify', {
    body: 'multipart', setUser: true, challenge: 'voice-verify', fields: ['session_id'], files: { voice: 1 },
  }),
  route('POST', '/api-gateway/v2/face-match', {
    body: 'multipart', setUser: true, fields: ['session_id', 'use_session_video'],
    files: { reference_image: 1, video: 1 },
  }),
  route('POST', '/api-gateway/v2/enrollments/face', {
    body: 'multipart', setUser: true, fields: ['is_document'], files: { face: 1 },
  }),
  route('POST', '/api-gateway/v2/enrollments/voice', {
    // Up to 4 recordings of the phrase (the gateway's RequiredUtterances).
    body: 'multipart', setUser: true, fields: ['phrase', 'vocabulary'], files: { voice: 4 },
  }),
  route('POST', '/api-gateway/v2/documents/check', {
    body: 'multipart', fields: ['session_id', 'provider', 'mrz_provider'], files: { document: 1 },
  }),
  route('POST', '/api-gateway/v2/deepfake/checks', {
    body: 'multipart', setUser: true, fields: ['session_id'], files: { video: 1 },
  }),
  // Custom consent templates only (Flutter approveConsent / getConsentApprovals).
  // They do not record the consent enrollment needs. Remove them if unused.
  route('POST', '/api-gateway/v2/consents/:consent_id/approve/:user_id', { body: 'none' }),
  route('GET', '/api-gateway/v2/consents/my-approvals/:user_id', { body: 'none' }),
];

/**
 * Request headers a cross-origin page may send (CORS preflight). Add your own
 * auth headers, for example `x-csrf-token`, with createProxy({ allowedHeaders })
 * or ALLOWED_HEADERS. This only lets the browser send them to this server;
 * they are not forwarded to Biometry.
 */
export const CORS_ALLOWED_HEADERS = ['authorization', 'content-type', 'x-client-app', 'x-client-app-version'];

/** Client request headers passed on to Biometry. The caller's Authorization and cookies are not. */
const FORWARDED_REQUEST_HEADERS = ['x-client-app', 'x-client-app-version'];

/** Biometry response headers passed back to the client. */
const FORWARDED_RESPONSE_HEADERS = /^(content-type|x-request-id|retry-after|x-ratelimit-[a-z-]+|ratelimit(-[a-z]+)?)$/i;

class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

/**
 * DEMO ONLY, enabled with ALLOW_DEMO_AUTH=1: maps the bearer token
 * `demo-app-token` to the user `user-123`. Use your real session or JWT check.
 */
function demoAuthenticate(req) {
  const demoUsers = { 'demo-app-token': 'user-123' };
  const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  return match ? demoUsers[match[1]] : undefined;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function checkType(name, value) {
  const type = FIELD_TYPES[name];
  const ok = type === 'services'
    ? value !== null && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).every((k) => k === 'include' || k === 'exclude')
      && Object.values(value).every((v) => Array.isArray(v) && v.every((s) => typeof s === 'string'))
    : typeof value === type;
  if (!ok) throw new HttpError(400, `invalid ${name}`);
}

function parseJson(text, what) {
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new HttpError(400, `${what} must be a JSON object`);
  }
}

/**
 * Builds a NEW request object from the route's allowed fields. Exact,
 * lower-case key names only, so `USER_ID` or `uſer_id` never get through.
 */
async function rebuildRequestPart(route, clientPart, ctx) {
  const { userId, sessions, challenges } = ctx;
  const part = {};
  for (const name of route.fields ?? []) {
    if (!Object.hasOwn(clientPart, name) || clientPart[name] === null) continue;
    checkType(name, clientPart[name]);
    part[name] = clientPart[name];
  }
  if (part.services && route.requiredServices) {
    const { include, exclude = [] } = part.services;
    for (const name of route.requiredServices) {
      if (exclude.includes(name) || (include && !include.includes(name))) {
        throw new HttpError(400, `services may not skip ${name}: it checks the liveness challenge`);
      }
    }
  }
  if (part.session_id !== undefined && (await sessions.owner(part.session_id)) !== userId) {
    throw new HttpError(403, 'session does not belong to the signed-in user');
  }
  if (route.challenge) {
    if (part.session_id === undefined) throw new HttpError(400, 'session_id is required for a challenge');
    // Never empty: without a phrase the gateway falls back to form values.
    // Reserved, not used: the handler commits it only when Biometry answers 2xx.
    const reservation = await challenges.reserve(userId, part.session_id, route.challenge);
    if (!reservation) {
      throw new HttpError(409, 'no valid liveness challenge for this session (missing, expired, used, or in use by another request): request one from POST /challenge');
    }
    ctx.reservation = reservation;
    part.phrase = reservation.value;
    part.vocabulary = CHALLENGE_VOCABULARY;
  }
  if (route.setUser) part.user_id = userId;
  return part;
}

/** Returns the body to send upstream, rebuilt from the client's body. */
async function rebuildBody(route, req, ctx) {
  if (route.body === 'none') return undefined;

  const contentType = req.headers['content-type'] ?? '';
  if (route.body === 'multipart' && !/^multipart\/form-data;/i.test(contentType)) {
    throw new HttpError(415, 'expected multipart/form-data');
  }

  const raw = await readBody(req);

  if (route.body === 'json') {
    const clientBody = raw.length ? parseJson(raw.toString('utf8'), 'body') : {};
    const body = await rebuildRequestPart(route, clientBody, ctx);
    return Object.keys(body).length ? JSON.stringify(body) : undefined;
  }

  let form;
  try {
    form = await new Request('http://local/', {
      method: 'POST', headers: { 'content-type': contentType }, body: raw,
    }).formData();
  } catch {
    throw new HttpError(400, 'invalid multipart/form-data body');
  }
  const requestPart = form.get('request');
  const clientPart = typeof requestPart === 'string' ? parseJson(requestPart, 'request part') : {};

  const out = new FormData();
  out.append('request', JSON.stringify(await rebuildRequestPart(route, clientPart, ctx)));
  for (const [name, max] of Object.entries(route.files)) {
    const files = form.getAll(name).filter((f) => typeof f !== 'string').slice(0, max);
    for (const file of files) out.append(name, file, file.name);
  }
  return out;
}

/** Checks the path parameters and returns the path to forward, rebuilt from them. */
async function checkedPath(route, pathname, userId, sessions) {
  const match = route.pattern.exec(pathname);
  const values = {};
  route.params.forEach((name, i) => {
    let value;
    try {
      value = decodeURIComponent(match[i + 1]);
    } catch {
      throw new HttpError(400, `invalid ${name}`);
    }
    if (!SAFE_ID.test(value)) throw new HttpError(400, `invalid ${name}`);
    values[name] = value;
  });
  if (values.user_id !== undefined && values.user_id !== userId) {
    throw new HttpError(403, 'user_id does not belong to the signed-in user');
  }
  if (values.session_id !== undefined && (await sessions.owner(values.session_id)) !== userId) {
    throw new HttpError(403, 'session does not belong to the signed-in user');
  }
  const path = route.template.replace(/:(\w+)/g, (_, name) => encodeURIComponent(values[name]));
  return { path, values };
}

/** Keeps only the route's allowed query parameters with their allowed value. */
function rebuildQuery(route, searchParams) {
  const out = new URLSearchParams();
  for (const [name, allowed] of Object.entries(route.query ?? {})) {
    if (searchParams.get(name) === allowed) out.set(name, allowed);
  }
  const query = out.toString();
  return query ? `?${query}` : '';
}

/** Returns `value` without trailing `/` characters. No regex, so no backtracking. */
function trimTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

/**
 * The caller's IP address. With `trustProxy` 0 it is the socket address.
 * Behind N proxies or load balancers that each append to `x-forwarded-for`,
 * set `trustProxy` to N to use the address the outermost one saw. Never set
 * it without such proxies: clients can write `x-forwarded-for` themselves.
 */
export function clientAddress(req, trustProxy = 0) {
  const socketAddress = req.socket.remoteAddress;
  const header = req.headers['x-forwarded-for'];
  if (!trustProxy || typeof header !== 'string') return socketAddress;
  const hops = header.split(',').map((h) => h.trim()).filter(Boolean);
  // Fewer entries than trusted proxies: the request skipped one of them, so
  // the leftmost entry may have been written by the client. Same for non-IPs.
  if (hops.length < trustProxy) return socketAddress;
  const hop = hops[hops.length - trustProxy];
  return isIP(hop) ? hop : socketAddress;
}

/**
 * The scheme the browser used to reach this server: `https:` or `http:`.
 * Without trusted proxies it is the socket's own. Behind a load balancer that
 * terminates TLS (`trustProxy` 1 or more), it is the `x-forwarded-proto` the
 * nearest proxy set; clients can write that header themselves, so it is only
 * read when `trustProxy` says a proxy is there to overwrite it.
 */
export function requestScheme(req, trustProxy = 0) {
  const own = req.socket.encrypted ? 'https:' : 'http:';
  const header = req.headers['x-forwarded-proto'];
  if (!trustProxy || typeof header !== 'string') return own;
  const proto = header.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean).pop();
  return proto === 'https' || proto === 'http' ? `${proto}:` : own;
}

/**
 * Browser requests carry `Origin`. Accept only your app's origin
 * (`allowedOrigin`) or this server's own origin (same scheme and host), so
 * another site cannot make a signed-in user's browser call the proxy with
 * their cookies (a form or `text/plain` POST needs no CORS preflight). The
 * scheme matters: `http://example.com` is a different site from
 * `https://example.com`, and a plain-http page there must not pass. Requests
 * without `Origin` (native apps, server-to-server) are allowed.
 */
function originAllowed(req, allowedOrigin, trustProxy) {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  if (allowedOrigin && origin === allowedOrigin) return true;
  try {
    const url = new URL(origin);
    return url.protocol === requestScheme(req, trustProxy) && url.host === req.headers.host;
  } catch {
    return false; // includes "null"
  }
}

function requireJson(req) {
  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'content-type must be application/json');
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

/**
 * Creates the proxy server.
 *
 * @param {object} options
 * @param {string} options.apiKey - Your Biometry project API key.
 * @param {(req: http.IncomingMessage) => string | undefined | Promise<string | undefined>} options.authenticate -
 *   Returns the user_id the caller may act as, from YOUR session, or undefined.
 * @param {string} [options.apiUrl] - Where requests go. Defaults to the Biometry API.
 * @param {string} [options.allowedOrigin] - Your web app's origin, for CORS.
 * @param {string[]} [options.allowedHeaders] - Extra request headers a cross-origin page may
 *   send (for example your CSRF header), added to CORS_ALLOWED_HEADERS.
 * @param {number} [options.trustProxy] - How many proxies or load balancers in front of this
 *   server append to `x-forwarded-for`. 0 (default) uses the socket address. See clientAddress().
 * @param {SessionStore} [options.sessions] - Session ownership. Use shared storage in production.
 * @param {ChallengeStore} [options.challenges] - Liveness challenges. Use shared storage in production.
 * @param {number} [options.sweepIntervalMs] - How often expired entries are dropped from the
 *   stores (calls their `sweep()` if they have one). 0 turns it off.
 * @param {number} [options.upstreamTimeoutMs] - How long a Biometry call may take before the
 *   proxy answers 504. Keep it above your slowest call.
 *
 * Store methods (`owner`, `allowStart`, `add`, `delete`, `issue`, `reserve`,
 * `commit`, `release`, `deleteSession`) may be synchronous or return Promises.
 */
export function createProxy({
  apiKey,
  authenticate,
  apiUrl = 'https://api.biometrysolutions.com',
  allowedOrigin,
  allowedHeaders = [],
  trustProxy = 0,
  sessions = new SessionStore(),
  challenges = new ChallengeStore(),
  sweepIntervalMs = 60 * 1000,
  upstreamTimeoutMs = UPSTREAM_TIMEOUT_MS,
}) {
  if (!apiKey) throw new Error('apiKey is required');
  if (typeof authenticate !== 'function') throw new Error('authenticate is required');
  if (!Number.isInteger(trustProxy) || trustProxy < 0) {
    throw new Error('trustProxy must be a whole number of proxies, 0 or more');
  }
  const upstreamBase = trimTrailingSlashes(apiUrl);
  const corsHeaders = new Set([...CORS_ALLOWED_HEADERS, ...allowedHeaders.map((h) => h.toLowerCase())]);

  /** The preflight's requested headers that are on the allow list, or the whole list. */
  function corsAllowHeaders(req) {
    const requested = req.headers['access-control-request-headers'];
    if (typeof requested !== 'string') return [...corsHeaders].join(', ');
    return requested.split(',').map((h) => h.trim().toLowerCase()).filter((h) => corsHeaders.has(h)).join(', ');
  }

  async function issueChallenge(req, userId) {
    requireJson(req);
    const raw = await readBody(req);
    const body = raw.length ? parseJson(raw.toString('utf8'), 'body') : {};
    const sessionId = body.session_id;
    if (typeof sessionId !== 'string') throw new HttpError(400, 'session_id is required');
    if ((await sessions.owner(sessionId)) !== userId) throw new HttpError(403, 'session does not belong to the signed-in user');
    const issued = await challenges.issue(userId, sessionId);
    if (!issued) throw new HttpError(429, 'too many challenges, try again later', { 'retry-after': String(RATE_WINDOW_MS / 1000) });
    // The device shows these digits; the proxy keeps its own copy.
    return { challenge: issued.value, expires_in: issued.expiresInSeconds };
  }

  async function onboardingConsent(req, userId) {
    requireJson(req);
    const raw = await readBody(req);
    const body = raw.length ? parseJson(raw.toString('utf8'), 'body') : {};
    if (body.accepted !== true) throw new HttpError(400, 'accepted must be true');
    if (!CONSENT_USER_ID.test(userId)) {
      throw new HttpError(400, 'user_id must be 3 to 128 characters of A-Za-z0-9._:@- for consent');
    }
    const clientHeaders = {};
    if (req.headers['user-agent']) clientHeaders['user-agent'] = req.headers['user-agent'];
    const address = clientAddress(req, trustProxy);
    if (address) clientHeaders['x-forwarded-for'] = address;
    const failed = await recordConsent({
      apiUrl: upstreamBase, apiKey, userId, clientHeaders, signal: AbortSignal.timeout(upstreamTimeoutMs),
    });
    if (failed) throw new HttpError(502, `consent was not recorded (Biometry answered ${failed.status})`);
    return { consent: 'recorded' };
  }

  const OWN_ROUTES = { 'POST /challenge': issueChallenge, 'POST /onboarding/consent': onboardingConsent };

  const server = http.createServer(async (req, res) => {
    if (allowedOrigin) {
      // Credentials allowed, so the page can use cookies (`credentials: 'include'`
      // in the web SDK) or an Authorization header for your own session.
      res.setHeader('access-control-allow-origin', allowedOrigin);
      res.setHeader('access-control-allow-credentials', 'true');
      res.setHeader('vary', 'Origin, Access-Control-Request-Headers');
      const allowHeaders = corsAllowHeaders(req);
      if (allowHeaders) res.setHeader('access-control-allow-headers', allowHeaders);
      res.setHeader('access-control-allow-methods', 'GET, POST');
      if (req.method === 'OPTIONS') return res.writeHead(204).end();
    }

    // Carries the liveness challenge reservation, if this route takes one.
    const ctx = { userId: undefined, sessions, challenges, reservation: undefined };
    try {
      const url = new URL(req.url, 'http://local');
      const own = OWN_ROUTES[`${req.method} ${url.pathname}`];
      const route = own ? undefined : ROUTES.find((r) => r.method === req.method && r.pattern.test(url.pathname));
      if (!own && !route) return sendJson(res, 404, { error: 'not found' });
      if (!originAllowed(req, allowedOrigin, trustProxy)) return sendJson(res, 403, { error: 'origin not allowed' });

      const userId = await authenticate(req);
      if (typeof userId !== 'string' || !userId) return sendJson(res, 401, { error: 'sign in first' });
      ctx.userId = userId;

      if (own) return sendJson(res, 200, await own(req, userId));

      const { path, values } = await checkedPath(route, url.pathname, userId, sessions);
      if (route.startsSession && !(await sessions.allowStart(userId))) {
        throw new HttpError(429, 'too many sessions, try again later', { 'retry-after': String(RATE_WINDOW_MS / 1000) });
      }
      const body = await rebuildBody(route, req, ctx);

      const headers = { authorization: `Bearer ${apiKey}` };
      if (typeof body === 'string') headers['content-type'] = 'application/json';
      for (const name of FORWARDED_REQUEST_HEADERS) {
        if (req.headers[name]) headers[name] = req.headers[name];
      }

      // fetch sets the multipart content-type (with a fresh boundary) for FormData.
      const upstream = await fetch(`${upstreamBase}${path}${rebuildQuery(route, url.searchParams)}`, {
        method: req.method,
        headers,
        body,
        // Covers reading the response body too.
        signal: AbortSignal.timeout(upstreamTimeoutMs),
      });
      // Biometry handled it, so the challenge is used. On any other status, or
      // if fetch threw, the finally block below releases it for a retry.
      if (upstream.ok) await ctx.reservation?.commit();
      const responseBody = Buffer.from(await upstream.arrayBuffer());

      if (route.startsSession && upstream.ok) {
        let sessionId;
        try {
          sessionId = JSON.parse(responseBody.toString('utf8'))?.data?.session_id;
        } catch {
          // Not JSON: nothing to record. The response is passed back as is.
        }
        if (typeof sessionId === 'string') await sessions.add(sessionId, userId);
      }
      if (route.endsSession && upstream.ok) {
        await sessions.delete(values.session_id);
        await challenges.deleteSession(userId, values.session_id);
      }

      const responseHeaders = {};
      upstream.headers.forEach((value, name) => {
        if (FORWARDED_RESPONSE_HEADERS.test(name)) responseHeaders[name] = value;
      });
      res.writeHead(upstream.status, responseHeaders);
      res.end(responseBody);
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message }, err.headers);
      if (err?.name === 'TimeoutError') return sendJson(res, 504, { error: 'upstream timeout' });
      console.error(err);
      sendJson(res, 502, { error: 'upstream error' });
    } finally {
      try {
        await ctx.reservation?.release(); // does nothing once committed
      } catch (err) {
        console.error(err);
      }
    }
  });

  // The in-memory stores only drop an expired entry when it is read again;
  // sweep them so users who never come back do not hold memory forever.
  if (sweepIntervalMs > 0) {
    const timer = setInterval(() => {
      sessions.sweep?.();
      challenges.sweep?.();
    }, sweepIntervalMs);
    timer.unref();
    server.on('close', () => clearInterval(timer));
  }
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apiKey = process.env.BIOMETRY_API_KEY;
  if (!apiKey) {
    console.error('BIOMETRY_API_KEY environment variable is required');
    process.exit(1);
  }
  if (process.env.ALLOW_DEMO_AUTH !== '1') {
    console.error('No authenticate() configured. Import createProxy() and pass your own, '
      + 'or set ALLOW_DEMO_AUTH=1 to try the demo token (never in production).');
    process.exit(1);
  }
  console.warn('ALLOW_DEMO_AUTH=1: "Bearer demo-app-token" signs in as user-123. Demo only.');
  const port = Number(process.env.PORT ?? 3002);
  createProxy({
    apiKey,
    authenticate: demoAuthenticate,
    apiUrl: process.env.BIOMETRY_API_URL,
    allowedOrigin: process.env.ALLOWED_ORIGIN,
    allowedHeaders: (process.env.ALLOWED_HEADERS ?? '').split(',').map((h) => h.trim()).filter(Boolean),
    trustProxy: Number(process.env.TRUST_PROXY ?? 0),
    upstreamTimeoutMs: Number(process.env.UPSTREAM_TIMEOUT_MS ?? UPSTREAM_TIMEOUT_MS),
  }).listen(port, () => {
    console.log(`Biometry proxy on http://localhost:${port}`);
  });
}
