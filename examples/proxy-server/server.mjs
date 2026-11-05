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
//   4. adds `Authorization: Bearer <BIOMETRY_API_KEY>` and sends the rebuilt
//      request to the Biometry API.
//
// Zero dependencies, Node 18 or newer. Replace `authenticate()` and the
// in-memory session map with your own auth and storage before using it.

import http from 'node:http';
import { pathToFileURL } from 'node:url';

const MAX_BODY_BYTES = 50 * 1024 * 1024;

/** Path parameters (session ids, consent ids, user ids) must look like ids. */
const SAFE_ID = /^(?!\.{1,2}$)[A-Za-z0-9._:@-]{1,128}$/;

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

/**
 * The only calls the client SDKs make. Everything else gets 404.
 *
 * - `params`: names of the path segments captured by `pattern`.
 * - `body`: 'none' (nothing is forwarded), 'json' or 'multipart' (rebuilt).
 * - `setUser`: add `user_id` = signed-in user to the rebuilt request part.
 * - `fields` / `files`: what is copied from the client's request.
 * - `query`: query parameters kept, with the only value allowed for each.
 */
export const ROUTES = [
  {
    method: 'POST', pattern: /^\/api-gateway\/v2\/sessions$/, params: [],
    body: 'none', startsSession: true, query: { warmup: 'true' },
  },
  {
    method: 'POST', pattern: /^\/api-gateway\/v2\/sessions\/([^/]+)\/end$/, params: ['session_id'],
    body: 'json', fields: ['phone_number'],
  },
  {
    method: 'POST', pattern: /^\/api-gateway\/v2\/liveness$/, params: [],
    body: 'multipart', setUser: true,
    fields: ['session_id', 'phrase', 'vocabulary', 'trigger', 'services'], files: ['video'],
  },
  {
    method: 'POST', pattern: /^\/api-gateway\/v2\/face-verify$/, params: [],
    body: 'multipart', setUser: true, fields: ['session_id', 'phrase', 'vocabulary'], files: ['video'],
  },
  {
    method: 'POST', pattern: /^\/api-gateway\/v2\/voice-verify$/, params: [],
    body: 'multipart', setUser: true, fields: ['session_id', 'phrase', 'vocabulary'], files: ['voice'],
  },
  {
    method: 'POST', pattern: /^\/api-gateway\/v2\/face-match$/, params: [],
    body: 'multipart', setUser: true, fields: ['session_id', 'use_session_video'],
    files: ['reference_image', 'video'],
  },
  {
    method: 'POST', pattern: /^\/api-gateway\/v2\/enrollments\/face$/, params: [],
    body: 'multipart', setUser: true, fields: ['is_document'], files: ['face'],
  },
  {
    method: 'POST', pattern: /^\/api-gateway\/v2\/enrollments\/voice$/, params: [],
    body: 'multipart', setUser: true, fields: ['phrase', 'vocabulary'], files: ['voice'],
  },
  {
    method: 'POST', pattern: /^\/api-gateway\/v2\/documents\/check$/, params: [],
    body: 'multipart', setUser: false, fields: ['session_id', 'provider', 'mrz_provider'], files: ['document'],
  },
  {
    method: 'POST', pattern: /^\/api-gateway\/v2\/deepfake\/checks$/, params: [],
    body: 'multipart', setUser: true, fields: ['session_id'], files: ['video'],
  },
  {
    method: 'POST', pattern: /^\/api-gateway\/v2\/consents\/([^/]+)\/approve\/([^/]+)$/,
    params: ['consent_id', 'user_id'], body: 'none',
  },
  {
    method: 'GET', pattern: /^\/api-gateway\/v2\/consents\/my-approvals\/([^/]+)$/,
    params: ['user_id'], body: 'none',
  },
];

/** Client request headers passed on to Biometry. The caller's Authorization and cookies are not. */
const FORWARDED_REQUEST_HEADERS = ['x-client-app', 'x-client-app-version'];

/** Biometry response headers passed back to the client. */
const FORWARDED_RESPONSE_HEADERS = /^(content-type|x-request-id|retry-after|x-ratelimit-[a-z-]+|ratelimit(-[a-z]+)?)$/i;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * DEMO ONLY: returns the Biometry `user_id` the caller may act as, or
 * undefined. The app sends its own session token as `Authorization: Bearer
 * <token>` (the SDKs' `headers` option); this maps one static demo token to
 * one user. Replace it with your real session, cookie or JWT check.
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

/**
 * Builds a NEW request object from the route's allowed fields. Exact,
 * lower-case key names only, so `USER_ID` or `uſer_id` never get through.
 */
function rebuildRequestPart(route, clientPart, userId, sessionOwners) {
  const part = {};
  for (const name of route.fields ?? []) {
    if (!Object.hasOwn(clientPart, name) || clientPart[name] === null) continue;
    checkType(name, clientPart[name]);
    part[name] = clientPart[name];
  }
  if (part.session_id !== undefined && sessionOwners.get(part.session_id) !== userId) {
    throw new HttpError(403, 'session does not belong to the signed-in user');
  }
  if (route.setUser) part.user_id = userId;
  return part;
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

/** Returns the body to send upstream, rebuilt from the client's body. */
async function rebuildBody(route, req, userId, sessionOwners) {
  if (route.body === 'none') return undefined;

  const raw = await readBody(req);

  if (route.body === 'json') {
    const clientBody = raw.length ? parseJson(raw.toString('utf8'), 'body') : {};
    const body = rebuildRequestPart(route, clientBody, userId, sessionOwners);
    return Object.keys(body).length ? JSON.stringify(body) : undefined;
  }

  let form;
  try {
    form = await new Request('http://local/', {
      method: 'POST',
      headers: { 'content-type': req.headers['content-type'] ?? '' },
      body: raw,
    }).formData();
  } catch {
    throw new HttpError(400, 'expected a multipart/form-data body');
  }
  const requestPart = form.get('request');
  const clientPart = typeof requestPart === 'string' ? parseJson(requestPart, 'request part') : {};

  const out = new FormData();
  out.append('request', JSON.stringify(rebuildRequestPart(route, clientPart, userId, sessionOwners)));
  for (const name of route.files) {
    const file = form.get(name);
    if (file && typeof file !== 'string') out.append(name, file, file.name);
  }
  return out;
}

/** Checks the captured path segments; returns them decoded. */
function checkPathParams(route, match, userId, sessionOwners) {
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
  if (values.session_id !== undefined && sessionOwners.get(values.session_id) !== userId) {
    throw new HttpError(403, 'session does not belong to the signed-in user');
  }
  return values;
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

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Creates the proxy server.
 *
 * @param {object} options
 * @param {string} options.apiKey - Your Biometry project API key.
 * @param {string} [options.apiUrl] - Where requests go. Defaults to the Biometry API.
 * @param {(req: http.IncomingMessage) => string | undefined | Promise<string | undefined>} [options.authenticate]
 * @param {string} [options.allowedOrigin] - Your web app's origin, for CORS.
 * @param {Map<string, string>} [options.sessionOwners] - session_id -> user_id. Use real storage in production.
 */
export function createProxy({
  apiKey,
  apiUrl = 'https://api.biometrysolutions.com',
  authenticate = demoAuthenticate,
  allowedOrigin,
  sessionOwners = new Map(),
}) {
  if (!apiKey) throw new Error('apiKey is required');
  const upstreamBase = apiUrl.replace(/\/+$/, '');

  return http.createServer(async (req, res) => {
    if (allowedOrigin) {
      // Credentials allowed, so the page can use cookies (`credentials: 'include'`
      // in the web SDK) or an Authorization header for your own session.
      res.setHeader('access-control-allow-origin', allowedOrigin);
      res.setHeader('access-control-allow-credentials', 'true');
      res.setHeader('vary', 'Origin');
      res.setHeader('access-control-allow-headers', 'authorization, content-type, x-client-app, x-client-app-version');
      res.setHeader('access-control-allow-methods', 'GET, POST');
      if (req.method === 'OPTIONS') return res.writeHead(204).end();
    }

    try {
      const url = new URL(req.url, 'http://local');
      const route = ROUTES.find((r) => r.method === req.method && r.pattern.test(url.pathname));
      if (!route) return sendJson(res, 404, { error: 'not found' });

      const userId = await authenticate(req);
      if (!userId) return sendJson(res, 401, { error: 'sign in first' });

      checkPathParams(route, route.pattern.exec(url.pathname), userId, sessionOwners);
      const body = await rebuildBody(route, req, userId, sessionOwners);

      const headers = { authorization: `Bearer ${apiKey}` };
      if (typeof body === 'string') headers['content-type'] = 'application/json';
      for (const name of FORWARDED_REQUEST_HEADERS) {
        if (req.headers[name]) headers[name] = req.headers[name];
      }

      // fetch sets the multipart content-type (with a fresh boundary) for FormData.
      const upstream = await fetch(`${upstreamBase}${url.pathname}${rebuildQuery(route, url.searchParams)}`, {
        method: req.method,
        headers,
        body,
      });
      const responseBody = Buffer.from(await upstream.arrayBuffer());

      if (route.startsSession && upstream.ok) {
        let sessionId;
        try {
          sessionId = JSON.parse(responseBody.toString('utf8'))?.data?.session_id;
        } catch {
          // Not JSON: nothing to record. The response is passed back as is.
        }
        if (typeof sessionId === 'string') sessionOwners.set(sessionId, userId);
      }

      const responseHeaders = {};
      upstream.headers.forEach((value, name) => {
        if (FORWARDED_RESPONSE_HEADERS.test(name)) responseHeaders[name] = value;
      });
      res.writeHead(upstream.status, responseHeaders);
      res.end(responseBody);
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      console.error(err);
      sendJson(res, 502, { error: 'upstream error' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apiKey = process.env.BIOMETRY_API_KEY;
  if (!apiKey) {
    console.error('BIOMETRY_API_KEY environment variable is required');
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 3002);
  createProxy({
    apiKey,
    apiUrl: process.env.BIOMETRY_API_URL,
    allowedOrigin: process.env.ALLOWED_ORIGIN,
  }).listen(port, () => {
    console.log(`Biometry proxy on http://localhost:${port}`);
  });
}
