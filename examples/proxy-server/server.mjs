// Minimal backend proxy for Biometry client SDKs ("proxy mode").
//
// The browser or mobile app holds no Biometry token. It points the SDK at this
// server (`new BiometrySDK({ baseUrl })` or `Biometry.initialize(baseUrl: ...)`),
// and this server:
//   1. authenticates the caller as one of YOUR users,
//   2. only forwards the Biometry paths the app needs,
//   3. checks that the user_id and session_id in the request belong to that user,
//   4. adds `Authorization: Bearer <BIOMETRY_API_KEY>` and forwards the request
//      to the Biometry API with the same path and query.
//
// Zero dependencies, Node 18 or newer. Replace `authenticate()` and the
// in-memory session map with your own auth and storage before using it.

import http from 'node:http';

const BIOMETRY_API_URL = (process.env.BIOMETRY_API_URL ?? 'https://api.biometrysolutions.com').replace(/\/+$/, '');
const BIOMETRY_API_KEY = process.env.BIOMETRY_API_KEY;
const PORT = Number(process.env.PORT ?? 3002);
// Set to your web app's origin when the page is served from another origin.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;
const MAX_BODY_BYTES = 50 * 1024 * 1024;

if (!BIOMETRY_API_KEY) {
  console.error('BIOMETRY_API_KEY environment variable is required');
  process.exit(1);
}

/**
 * Returns the id of the signed-in user making this request, or undefined.
 *
 * DEMO ONLY: maps a static bearer token to a user. Use your real session,
 * cookie or JWT check here. The user id is the Biometry `user_id` this caller
 * is allowed to act as.
 */
function authenticate(req) {
  const demoUsers = { 'demo-app-token': 'user-123' };
  const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  return match ? demoUsers[match[1]] : undefined;
}

/** Session ids this proxy started, and the user each belongs to. Use real storage in production. */
const sessionOwners = new Map();

const V2 = '/api-gateway/v2';

/** The only calls the client SDKs make. Everything else is refused. */
const ROUTES = [
  { method: 'POST', pattern: /^\/api-gateway\/v2\/sessions$/, startsSession: true },
  { method: 'POST', pattern: /^\/api-gateway\/v2\/sessions\/([^/]+)\/end$/, sessionInPath: true },
  {
    method: 'POST',
    pattern: /^\/api-gateway\/v2\/(liveness|face-verify|voice-verify|face-match|enrollments\/face|enrollments\/voice|documents\/check|deepfake\/checks)$/,
    multipart: true,
  },
  { method: 'POST', pattern: /^\/api-gateway\/v2\/consents\/[^/]+\/approve\/([^/]+)$/, userInPath: true },
  { method: 'GET', pattern: /^\/api-gateway\/v2\/consents\/my-approvals\/([^/]+)$/, userInPath: true },
];

/** Client headers passed on to Biometry. The caller's own Authorization and cookies are not. */
const FORWARDED_HEADERS = ['content-type', 'x-client-app', 'x-client-app-version'];

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Reads the JSON `request` part of a multipart body, or {} if there is none. */
async function multipartRequestPart(contentType, body) {
  try {
    const form = await new Request('http://local/', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    }).formData();
    const part = form.get('request');
    const parsed = typeof part === 'string' ? JSON.parse(part) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw Object.assign(new Error('expected a multipart body with a JSON request part'), { status: 400 });
  }
}

/** Returns an error message if `userId` is acting outside what it owns, else undefined. */
async function checkOwnership(route, match, userId, req, body) {
  if (route.userInPath && decodeURIComponent(match[1]) !== userId) {
    return 'user_id does not belong to the signed-in user';
  }
  if (route.sessionInPath && sessionOwners.get(decodeURIComponent(match[1])) !== userId) {
    return 'session does not belong to the signed-in user';
  }
  if (route.multipart) {
    const part = await multipartRequestPart(req.headers['content-type'] ?? '', body);
    if (part.user_id !== undefined && part.user_id !== userId) {
      return 'user_id does not belong to the signed-in user';
    }
    if (part.session_id !== undefined && sessionOwners.get(part.session_id) !== userId) {
      return 'session does not belong to the signed-in user';
    }
  }
  return undefined;
}

const server = http.createServer(async (req, res) => {
  if (ALLOWED_ORIGIN) {
    res.setHeader('access-control-allow-origin', ALLOWED_ORIGIN);
    res.setHeader('access-control-allow-headers', 'authorization, content-type, x-client-app, x-client-app-version');
    res.setHeader('access-control-allow-methods', 'GET, POST');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
  }

  try {
    const url = new URL(req.url, 'http://local');
    const route = ROUTES.find((r) => r.method === req.method && r.pattern.test(url.pathname));
    if (!route) return send(res, 404, { error: 'not found' });

    const userId = authenticate(req);
    if (!userId) return send(res, 401, { error: 'sign in first' });

    const body = req.method === 'GET' ? undefined : await readBody(req);
    const denied = await checkOwnership(route, route.pattern.exec(url.pathname), userId, req, body);
    if (denied) return send(res, 403, { error: denied });

    const headers = { authorization: `Bearer ${BIOMETRY_API_KEY}` };
    for (const name of FORWARDED_HEADERS) {
      if (req.headers[name]) headers[name] = req.headers[name];
    }

    const upstream = await fetch(`${BIOMETRY_API_URL}${url.pathname}${url.search}`, {
      method: req.method,
      headers,
      body: body?.length ? body : undefined,
    });
    const responseBody = Buffer.from(await upstream.arrayBuffer());

    if (route.startsSession && upstream.ok) {
      const sessionId = JSON.parse(responseBody.toString('utf8'))?.data?.session_id;
      if (sessionId) sessionOwners.set(sessionId, userId);
    }

    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
    });
    res.end(responseBody);
  } catch (err) {
    console.error(err);
    send(res, err.status ?? 502, { error: err.status ? err.message : 'upstream error' });
  }
});

server.listen(PORT, () => {
  console.log(`Biometry proxy on http://localhost:${PORT}${V2} -> ${BIOMETRY_API_URL}${V2}`);
});
