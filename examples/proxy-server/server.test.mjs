// Run with: node --test   (Node 18+, no dependencies)
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  createProxy, recordConsent, ChallengeStore, SessionStore, generateChallenge, clientAddress, requestScheme,
  CHALLENGE_LENGTH, CHALLENGE_DIGITS, CHALLENGE_VOCABULARY,
} from './server.mjs';

const APP_AUTH = { authorization: 'Bearer app-token' }; // user-123
const OTHER_AUTH = { authorization: 'Bearer other-token' }; // victim
const SHORT_AUTH = { authorization: 'Bearer short-token' }; // "ab", too short for consent
const USERS = { 'Bearer app-token': 'user-123', 'Bearer other-token': 'victim', 'Bearer short-token': 'ab' };

let upstream;
let upstreamUrl;
let received; // requests the fake Biometry API got
let nextResponse; // what the fake Biometry API answers next
let upstreamGate; // when set, the fake Biometry API waits for this promise before answering

let proxy;
let proxyUrl;
let clock = 1_000_000;
const now = () => clock;
let sessions;
let challenges;

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

before(async () => {
  upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    if (upstreamGate) await upstreamGate;
    const { status = 200, headers = { 'content-type': 'application/json' }, body = '{"data":{},"meta":{}}' } =
      nextResponse ?? {};
    res.writeHead(status, headers);
    res.end(body);
  });
  upstreamUrl = await listen(upstream);
  // The proxy reads the current stores through these getters, so each test gets fresh ones.
  const sessionsProxy = new Proxy({}, { get: (_, k) => (typeof sessions[k] === 'function' ? sessions[k].bind(sessions) : sessions[k]) });
  const challengesProxy = new Proxy({}, { get: (_, k) => (typeof challenges[k] === 'function' ? challenges[k].bind(challenges) : challenges[k]) });
  proxy = createProxy({
    apiKey: 'project-key',
    apiUrl: upstreamUrl,
    authenticate: (req) => USERS[req.headers.authorization],
    sessions: sessionsProxy,
    challenges: challengesProxy,
    allowedOrigin: 'https://app.example.com',
    allowedHeaders: ['X-CSRF-Token'],
  });
  proxyUrl = await listen(proxy);
});

after(() => {
  upstream.close();
  proxy.close();
});

beforeEach(() => {
  received = [];
  nextResponse = undefined;
  upstreamGate = undefined;
  clock = 1_000_000;
  sessions = new SessionStore({ now });
  sessions.add('sess-mine', 'user-123');
  sessions.add('sess-mine-2', 'user-123');
  sessions.add('sess-other', 'victim');
  challenges = new ChallengeStore({ now });
});

async function issueChallenge(sessionId = 'sess-mine', headers = APP_AUTH) {
  const res = await fetch(`${proxyUrl}/challenge`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ session_id: sessionId }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()).challenge;
}

/** Parses a multipart body the fake upstream received. */
async function upstreamForm(rec) {
  return new Request('http://local/', {
    method: 'POST', headers: { 'content-type': rec.headers['content-type'] }, body: rec.body,
  }).formData();
}

async function upstreamPart(rec) {
  return JSON.parse((await upstreamForm(rec)).get('request'));
}

function multipart(requestPart, files = {}, extra = {}) {
  const form = new FormData();
  form.append('request', typeof requestPart === 'string' ? requestPart : JSON.stringify(requestPart));
  for (const [name, value] of Object.entries(files)) {
    for (const bytes of [].concat(value)) form.append(name, new Blob([bytes], { type: 'video/mp4' }), `${name}.mp4`);
  }
  for (const [name, value] of Object.entries(extra)) form.append(name, value);
  return form;
}

function post(path, body, headers = APP_AUTH) {
  return fetch(`${proxyUrl}${path}`, { method: 'POST', headers, body });
}

function postJson(path, json, headers = APP_AUTH) {
  return post(path, JSON.stringify(json), { ...headers, 'content-type': 'application/json' });
}

// ---------------------------------------------------------------------------
// Request rebuilding
// ---------------------------------------------------------------------------

test('createProxy requires apiKey and authenticate', () => {
  assert.throws(() => createProxy({ authenticate: () => 'u' }), /apiKey is required/);
  assert.throws(() => createProxy({ apiKey: 'k' }), /authenticate is required/);
});

test('case-variant and look-alike user_id keys never reach Biometry; user_id is set from the session', async () => {
  // Go's encoding/json matches keys case-insensitively and folds ſ to s, so a
  // proxy that only checked `user_id` and passed the body through could be fooled.
  const raw = '{"user_id":"user-123","USER_ID":"victim","uſer_id":"victim","User_Id":"victim"}';
  const res = await post('/api-gateway/v2/enrollments/face', multipart(raw, { face: 'img' }));
  assert.equal(res.status, 200);
  assert.equal((await upstreamForm(received[0])).get('request'), JSON.stringify({ user_id: 'user-123' }));
});

test('a client-supplied user_id for someone else is replaced, not forwarded', async () => {
  const res = await post('/api-gateway/v2/face-verify', multipart({ user_id: 'victim', session_id: 'sess-mine' }, { video: 'v' }));
  assert.equal(res.status, 200);
  assert.deepEqual(await upstreamPart(received[0]), { session_id: 'sess-mine', user_id: 'user-123' });
});

test('only allowed fields and files are forwarded, in a rebuilt multipart body', async () => {
  const challenge = await issueChallenge();
  const body = multipart(
    { session_id: 'sess-mine', phrase: 'one two', vocabulary: 'en_words', trigger: 'login', services: { exclude: ['voice_recognition'] }, phone_number: '+1', auto_enroll: true },
    { video: 'VIDEO-BYTES', document: 'not-for-this-route' },
    { phrase: 'form-field-injection', vocabulary: 'x' },
  );
  const res = await post('/api-gateway/v2/liveness', body);
  assert.equal(res.status, 200);

  const rec = received[0];
  const form = await upstreamForm(rec);
  assert.deepEqual([...form.keys()].sort(), ['request', 'video']);
  assert.deepEqual(JSON.parse(form.get('request')), {
    session_id: 'sess-mine', trigger: 'login', services: { exclude: ['voice_recognition'] },
    phrase: challenge, vocabulary: CHALLENGE_VOCABULARY, user_id: 'user-123',
  });
  assert.equal(await form.get('video').text(), 'VIDEO-BYTES');
  assert.equal(rec.headers.authorization, 'Bearer project-key');
});

test('voice enrollment forwards up to 4 voice files and keeps its phrase', async () => {
  const res = await post('/api-gateway/v2/enrollments/voice',
    multipart({ phrase: 'one two three', vocabulary: 'en_digits' }, { voice: ['a', 'b', 'c', 'd', 'e', 'f'] }));
  assert.equal(res.status, 200);
  const form = await upstreamForm(received[0]);
  assert.deepEqual(await Promise.all(form.getAll('voice').map((f) => f.text())), ['a', 'b', 'c', 'd']);
  assert.deepEqual(JSON.parse(form.get('request')), { phrase: 'one two three', vocabulary: 'en_digits', user_id: 'user-123' });
});

test('single-file routes forward only the first file', async () => {
  const res = await post('/api-gateway/v2/enrollments/face', multipart({}, { face: ['first', 'second'] }));
  assert.equal(res.status, 200);
  const form = await upstreamForm(received[0]);
  assert.deepEqual(await Promise.all(form.getAll('face').map((f) => f.text())), ['first']);
});

test('a non-multipart body on a multipart route is refused', async () => {
  let res = await postJson('/api-gateway/v2/enrollments/face', { user_id: 'victim' });
  assert.equal(res.status, 415);
  res = await post('/api-gateway/v2/enrollments/face', 'x', { ...APP_AUTH, 'content-type': 'multipart/form-data; boundary=zz' });
  assert.equal(res.status, 400);
  assert.equal(received.length, 0);
});

test('a session_id the user does not own is refused before Biometry is called', async () => {
  let res = await post('/api-gateway/v2/face-verify', multipart({ session_id: 'sess-other' }, { video: 'v' }));
  assert.equal(res.status, 403);
  res = await post('/api-gateway/v2/face-verify', multipart({ session_id: 'never-started' }, { video: 'v' }));
  assert.equal(res.status, 403);
  res = await post('/api-gateway/v2/sessions/sess-other/end', undefined);
  assert.equal(res.status, 403);
  assert.equal(received.length, 0);
});

test('wrong field types are refused, including malformed services', async () => {
  for (const part of [{ trigger: ['login'] }, { services: { exclude: 'asd' } }, { services: { EXCLUDE: ['asd'] } }, { services: { exclude: [1] } }]) {
    const res = await post('/api-gateway/v2/liveness', multipart({ session_id: 'sess-mine', ...part }, { video: 'v' }));
    assert.equal(res.status, 400, JSON.stringify(part));
  }
  assert.equal(received.length, 0);
});

test('the query string is dropped, except warmup=true on session start', async () => {
  nextResponse = { body: '{"data":{"session_id":"sess-new"},"meta":{}}' };
  let res = await post('/api-gateway/v2/sessions?warmup=true&phrase=x&user_id=victim', undefined);
  assert.equal(res.status, 200);
  assert.equal(received[0].url, '/api-gateway/v2/sessions?warmup=true');
  assert.equal(sessions.owner('sess-new'), 'user-123');

  nextResponse = undefined;
  res = await post('/api-gateway/v2/face-verify?phrase=x&vocabulary=y&trigger=z&is_document=true', multipart({}, { video: 'v' }));
  assert.equal(res.status, 200);
  assert.equal(received[1].url, '/api-gateway/v2/face-verify');
});

test('session start forwards no client body', async () => {
  nextResponse = { body: '{"data":{"session_id":"sess-new"},"meta":{}}' };
  const res = await postJson('/api-gateway/v2/sessions', { user_id: 'victim' });
  assert.equal(res.status, 200);
  assert.equal(received[0].body.length, 0);
});

test('a non-JSON 2xx from session start is passed back without crashing', async () => {
  nextResponse = { headers: { 'content-type': 'text/plain' }, body: 'ok' };
  const res = await post('/api-gateway/v2/sessions', undefined);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
});

test('session starts are rate limited per user', async () => {
  for (let i = 0; i < 20; i++) {
    nextResponse = { body: `{"data":{"session_id":"s-${i}"},"meta":{}}` };
    assert.equal((await post('/api-gateway/v2/sessions', undefined)).status, 200);
  }
  const res = await post('/api-gateway/v2/sessions', undefined);
  assert.equal(res.status, 429);
  assert.ok(res.headers.get('retry-after'));
  assert.equal((await post('/api-gateway/v2/sessions', undefined, OTHER_AUTH)).status, 200);
});

test('session ownership expires', async () => {
  clock += 60 * 60 * 1000;
  const res = await post('/api-gateway/v2/face-verify', multipart({ session_id: 'sess-mine' }, { video: 'v' }));
  assert.equal(res.status, 403);
});

test('end session forwards only phone_number and forgets the session', async () => {
  await issueChallenge();
  const res = await postJson('/api-gateway/v2/sessions/sess-mine/end',
    { phone_number: '+15551234567', user_id: 'victim', USER_ID: 'victim' });
  assert.equal(res.status, 200);
  assert.equal(received[0].body.toString(), JSON.stringify({ phone_number: '+15551234567' }));
  assert.equal(received[0].headers['content-type'], 'application/json');
  assert.equal(sessions.owner('sess-mine'), undefined);
  assert.equal(challenges.challenges.size, 0);
  assert.equal((await post('/api-gateway/v2/sessions/sess-mine/end', undefined)).status, 403);
});

test('path ids are checked and the forwarded path is rebuilt from them', async () => {
  let res = await post('/api-gateway/v2/consents/consent-1/approve/victim', undefined);
  assert.equal(res.status, 403);
  // URL parsing turns %2E%2E into a `..` segment, so this one never matches a route.
  res = await post('/api-gateway/v2/consents/%2E%2E/approve/user-123', undefined);
  assert.ok([400, 404].includes(res.status), String(res.status));
  res = await post('/api-gateway/v2/consents/a%2Fb/approve/user-123', undefined);
  assert.equal(res.status, 400);
  assert.equal(received.length, 0);

  res = await post('/api-gateway/v2/consents/c%2D1/approve/user%2D123', undefined);
  assert.equal(res.status, 200);
  assert.equal(received[0].url, '/api-gateway/v2/consents/c-1/approve/user-123');

  res = await fetch(`${proxyUrl}/api-gateway/v2/consents/my-approvals/user-123`, { headers: APP_AUTH });
  assert.equal(res.status, 200);
  assert.equal(received[1].url, '/api-gateway/v2/consents/my-approvals/user-123');
});

test('unauthenticated callers get 401 and unknown paths 404', async () => {
  let res = await post('/api-gateway/v2/sessions', undefined, {});
  assert.equal(res.status, 401);
  res = await post('/api-gateway/v2/transactions', undefined);
  assert.equal(res.status, 404);
  assert.equal(received.length, 0);
});

test('the caller\'s own credentials are not forwarded; safe response headers are', async () => {
  nextResponse = {
    status: 422,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-1', 'retry-after': '3', 'set-cookie': 'x=1' },
    body: '{"error":{"code":"face_not_detected","message":"no face"},"meta":{}}',
  };
  const res = await post('/api-gateway/v2/enrollments/face', multipart({}, { face: 'f' }), { ...APP_AUTH, cookie: 'app=1', 'x-client-app': 'MyApp' });
  assert.equal(res.status, 422);
  assert.equal(res.headers.get('x-request-id'), 'req-1');
  assert.equal(res.headers.get('retry-after'), '3');
  assert.equal(res.headers.get('set-cookie'), null);
  assert.equal(received[0].headers.authorization, 'Bearer project-key');
  assert.equal(received[0].headers.cookie, undefined);
  assert.equal(received[0].headers['x-client-app'], 'MyApp');
});

test('CORS allows credentials for the configured origin', async () => {
  const res = await fetch(`${proxyUrl}/api-gateway/v2/sessions`, { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://app.example.com');
  assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(res.headers.get('vary'), 'Origin, Access-Control-Request-Headers');
  assert.equal(res.headers.get('access-control-allow-headers'),
    'authorization, content-type, x-client-app, x-client-app-version, x-csrf-token');
});

test('CORS allows only the requested headers that are on the allow list', async () => {
  const res = await fetch(`${proxyUrl}/api-gateway/v2/liveness`, {
    method: 'OPTIONS',
    headers: { 'access-control-request-headers': 'Authorization, X-Evil, content-type, x-csrf-token' },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-headers'), 'authorization, content-type, x-csrf-token');
});

test('clientAddress uses the socket address unless trustProxy is set', () => {
  const req = (xff) => ({ socket: { remoteAddress: '10.0.0.9' }, headers: xff ? { 'x-forwarded-for': xff } : {} });
  assert.equal(clientAddress(req('6.6.6.6'), 0), '10.0.0.9');
  assert.equal(clientAddress(req(), 1), '10.0.0.9');
  // One trusted load balancer appended the address it saw; the client-written entry is ignored.
  assert.equal(clientAddress(req('6.6.6.6, 203.0.113.7'), 1), '203.0.113.7');
  assert.equal(clientAddress(req('6.6.6.6, 203.0.113.7, 10.0.0.2'), 2), '203.0.113.7');
  // Fewer entries than trusted proxies, or not an IP: the client may have written it.
  assert.equal(clientAddress(req('203.0.113.7'), 3), '10.0.0.9');
  assert.equal(clientAddress(req('6.6.6.6, not-an-ip'), 1), '10.0.0.9');
  assert.equal(clientAddress(req('6.6.6.6, 2001:db8::1'), 1), '2001:db8::1');
  assert.throws(() => createProxy({ apiKey: 'k', authenticate: () => 'u', trustProxy: -1 }), /trustProxy/);
});

test('sweep drops expired sessions, challenges and ended rate-limit windows', () => {
  const s = new SessionStore({ now });
  s.add('old', 'user-123');
  s.allowStart('user-123');
  const c = new ChallengeStore({ now });
  c.issue('user-123', 'old');
  clock += 60 * 60 * 1000;
  s.add('new', 'user-123');
  s.sweep();
  c.sweep();
  assert.deepEqual([...s.owners.keys()], ['new']);
  assert.equal(s.starts.windows.size, 0);
  assert.equal(c.challenges.size, 0);
  assert.equal(c.issued.windows.size, 0);
});

// ---------------------------------------------------------------------------
// Liveness challenge: bound to user + session; liveness and voice-verify each once
// ---------------------------------------------------------------------------

test('generateChallenge gives CHALLENGE_LENGTH distinct digits from CHALLENGE_DIGITS', () => {
  for (let i = 0; i < 200; i++) {
    const c = generateChallenge();
    assert.equal(c.length, CHALLENGE_LENGTH);
    assert.equal(new Set(c).size, CHALLENGE_LENGTH);
    for (const d of c) assert.ok(CHALLENGE_DIGITS.includes(d), c);
  }
});

test('the stored challenge overwrites the device phrase, and vocabulary is pinned', async () => {
  const challenge = await issueChallenge();
  for (const [path, file] of [['liveness', 'video'], ['voice-verify', 'voice']]) {
    const res = await post(`/api-gateway/v2/${path}`,
      multipart({ session_id: 'sess-mine', phrase: 'five two nine', PHRASE: '1234567', vocabulary: 'en_words' }, { [file]: 'v' }));
    assert.equal(res.status, 200, path);
    const part = await upstreamPart(received.at(-1));
    assert.equal(part.phrase, challenge, path);
    assert.equal(part.vocabulary, CHALLENGE_VOCABULARY, path);
    assert.equal(Object.keys(part).filter((k) => k.toLowerCase() === 'phrase').length, 1);
  }
});

test('liveness then voice-verify each use the challenge once; a second liveness gets 409', async () => {
  await issueChallenge();
  const body = (file) => multipart({ session_id: 'sess-mine' }, { [file]: 'v' });
  assert.equal((await post('/api-gateway/v2/liveness', body('video'))).status, 200);
  assert.equal((await post('/api-gateway/v2/voice-verify', body('voice'))).status, 200);
  assert.equal((await post('/api-gateway/v2/liveness', body('video'))).status, 409);
  assert.equal((await post('/api-gateway/v2/voice-verify', body('voice'))).status, 409);
  assert.equal(received.length, 2);
});

test('a second liveness for the same challenge gets 409 even before voice-verify', async () => {
  await issueChallenge();
  const body = multipart({ session_id: 'sess-mine' }, { video: 'v' });
  assert.equal((await post('/api-gateway/v2/liveness', body)).status, 200);
  assert.equal((await post('/api-gateway/v2/liveness', multipart({ session_id: 'sess-mine' }, { video: 'v' }))).status, 409);
});

test('face-verify needs no challenge and sends no phrase', async () => {
  const res = await post('/api-gateway/v2/face-verify', multipart({ session_id: 'sess-mine', phrase: '12345678', vocabulary: 'x' }, { video: 'v' }));
  assert.equal(res.status, 200);
  assert.deepEqual(await upstreamPart(received[0]), { session_id: 'sess-mine', user_id: 'user-123' });
});

test('a missing challenge gives 409 and nothing is sent to Biometry', async () => {
  const res = await post('/api-gateway/v2/liveness', multipart({ session_id: 'sess-mine', phrase: '12345678' }, { video: 'v' }));
  assert.equal(res.status, 409);
  assert.equal(received.length, 0);
});

test('challenge routes need a session_id', async () => {
  await issueChallenge();
  const res = await post('/api-gateway/v2/liveness', multipart({}, { video: 'v' }));
  assert.equal(res.status, 400);
  assert.equal(received.length, 0);
});

test('a challenge from another session of the same user gives 409', async () => {
  await issueChallenge('sess-mine');
  const res = await post('/api-gateway/v2/liveness', multipart({ session_id: 'sess-mine-2' }, { video: 'v' }));
  assert.equal(res.status, 409);
  assert.equal(received.length, 0);
});

test('an expired challenge gives 409; just inside 5 minutes it works', async () => {
  await issueChallenge();
  clock += 5 * 60 * 1000 - 1;
  assert.equal((await post('/api-gateway/v2/liveness', multipart({ session_id: 'sess-mine' }, { video: 'v' }))).status, 200);
  clock += 1;
  assert.equal((await post('/api-gateway/v2/voice-verify', multipart({ session_id: 'sess-mine' }, { voice: 'v' }))).status, 409);
});

test('a challenge issued to another user cannot be used', async () => {
  const victimsChallenge = await issueChallenge('sess-other', OTHER_AUTH);
  // Can't name the victim's session, and has no challenge of its own.
  let res = await post('/api-gateway/v2/liveness', multipart({ session_id: 'sess-other', phrase: victimsChallenge }, { video: 'v' }));
  assert.equal(res.status, 403);
  res = await post('/api-gateway/v2/liveness', multipart({ session_id: 'sess-mine', phrase: victimsChallenge }, { video: 'v' }));
  assert.equal(res.status, 409);
  assert.equal(received.length, 0);

  // Still there for the victim.
  res = await post('/api-gateway/v2/liveness', multipart({ session_id: 'sess-other' }, { video: 'v' }), OTHER_AUTH);
  assert.equal(res.status, 200);
  assert.equal((await upstreamPart(received[0])).phrase, victimsChallenge);
});

test('an upstream 5xx does not use the challenge; the retry gets the same one', async () => {
  const challenge = await issueChallenge();
  nextResponse = { status: 503, body: '{"error":"busy"}' };
  const body = () => multipart({ session_id: 'sess-mine' }, { video: 'v' });
  assert.equal((await post('/api-gateway/v2/liveness', body())).status, 503);
  nextResponse = undefined;
  assert.equal((await post('/api-gateway/v2/liveness', body())).status, 200);
  assert.equal((await upstreamPart(received[1])).phrase, challenge);
  assert.equal((await post('/api-gateway/v2/liveness', body())).status, 409);
});

test('a network error does not use the challenge', async () => {
  const challenge = await issueChallenge();
  const dead = http.createServer();
  const deadUrl = await listen(dead);
  await new Promise((resolve) => dead.close(resolve));
  const broken = createProxy({
    apiKey: 'project-key', apiUrl: deadUrl, authenticate: (req) => USERS[req.headers.authorization],
    sessions, challenges, sweepIntervalMs: 0,
  });
  const brokenUrl = await listen(broken);
  const original = console.error;
  console.error = () => {};
  try {
    const res = await fetch(`${brokenUrl}/api-gateway/v2/liveness`, {
      method: 'POST', headers: APP_AUTH, body: multipart({ session_id: 'sess-mine' }, { video: 'v' }),
    });
    assert.equal(res.status, 502);
  } finally {
    console.error = original;
    broken.close();
  }
  assert.equal((await post('/api-gateway/v2/liveness', multipart({ session_id: 'sess-mine' }, { video: 'v' }))).status, 200);
  assert.equal((await upstreamPart(received[0])).phrase, challenge);
});

test('a concurrent double submit cannot use one challenge twice', async () => {
  await issueChallenge();
  let open;
  upstreamGate = new Promise((resolve) => { open = resolve; });
  const first = post('/api-gateway/v2/liveness', multipart({ session_id: 'sess-mine' }, { video: 'v' }));
  while (received.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  // The first request is waiting on Biometry with the challenge reserved.
  const second = await post('/api-gateway/v2/liveness', multipart({ session_id: 'sess-mine' }, { video: 'v' }));
  assert.equal(second.status, 409);
  // voice-verify has its own use and is not blocked by the liveness reservation.
  upstreamGate = undefined;
  assert.equal((await post('/api-gateway/v2/voice-verify', multipart({ session_id: 'sess-mine' }, { voice: 'v' }))).status, 200);
  open();
  assert.equal((await first).status, 200);
  assert.equal((await post('/api-gateway/v2/liveness', multipart({ session_id: 'sess-mine' }, { video: 'v' }))).status, 409);
  assert.equal(received.length, 2);
});

test('ChallengeStore reserve: commit uses the route, release frees it, both only once', () => {
  const store = new ChallengeStore({ now, generate: () => '12345678' });
  store.issue('u', 's');
  const r1 = store.reserve('u', 's', 'liveness');
  assert.equal(r1.value, '12345678');
  assert.equal(store.reserve('u', 's', 'liveness'), undefined); // in flight
  r1.release();
  r1.commit(); // ignored: already settled
  const r2 = store.reserve('u', 's', 'liveness');
  assert.ok(r2);
  r2.commit();
  r2.release(); // ignored
  assert.equal(store.reserve('u', 's', 'liveness'), undefined); // used
  // A reservation on a replaced challenge does not delete the new one.
  const r3 = store.reserve('u', 's', 'voice-verify');
  store.issue('u', 's');
  r3.commit();
  assert.ok(store.reserve('u', 's', 'liveness'));
});

test('liveness may not skip the challenge checks or face liveness detection', async () => {
  await issueChallenge();
  for (const services of [
    { exclude: ['active_speaker_detection'] },
    { exclude: ['face_liveness_detection'] },
    { include: ['active_speaker_detection', 'visual_speech_recognition'] },
    { exclude: ['visual_speech_recognition', 'face_recognition'] },
    { include: ['face_liveness_detection'] },
  ]) {
    const res = await post('/api-gateway/v2/liveness', multipart({ session_id: 'sess-mine', services }, { video: 'v' }));
    assert.equal(res.status, 400, JSON.stringify(services));
  }
  assert.equal(received.length, 0);
  const ok = { exclude: ['voice_recognition'] };
  const res = await post('/api-gateway/v2/liveness', multipart({ session_id: 'sess-mine', services: ok }, { video: 'v' }));
  assert.equal(res.status, 200);
  assert.deepEqual((await upstreamPart(received[0])).services, ok);
});

test('a failing store sweep is logged and does not crash the proxy', async () => {
  const failing = (kind) => ({
    sweep: kind === 'reject' ? () => Promise.reject(new Error('store down')) : () => { throw new Error('store down'); },
  });
  const unhandled = [];
  const onUnhandled = (err) => unhandled.push(err);
  process.on('unhandledRejection', onUnhandled);
  const logged = [];
  const original = console.error;
  console.error = (err) => logged.push(err);
  const p = createProxy({
    apiKey: 'k', authenticate: () => 'u', sessions: failing('reject'), challenges: failing('throw'), sweepIntervalMs: 5,
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 40));
  } finally {
    p.close();
    console.error = original;
    process.off('unhandledRejection', onUnhandled);
  }
  assert.equal(unhandled.length, 0);
  assert.ok(logged.length >= 2, `logged ${logged.length}`);
  assert.ok(logged.every((err) => err instanceof Error && err.message === 'store down'));
});

test('a failed challenge commit answers 500 and keeps the challenge usable', async () => {
  const challenge = await issueChallenge();
  const broken = new Proxy(challenges, {
    get: (target, key) => {
      if (key !== 'reserve') return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
      return (...args) => {
        const r = target.reserve(...args);
        return r && { ...r, commit: () => Promise.reject(new Error('store down')), release: r.release };
      };
    },
  });
  const p = createProxy({
    apiKey: 'project-key', apiUrl: upstreamUrl, authenticate: (req) => USERS[req.headers.authorization],
    sessions, challenges: broken, sweepIntervalMs: 0,
  });
  const pUrl = await listen(p);
  const original = console.error;
  console.error = () => {};
  try {
    const res = await fetch(`${pUrl}/api-gateway/v2/liveness`, {
      method: 'POST', headers: APP_AUTH, body: multipart({ session_id: 'sess-mine' }, { video: 'v' }),
    });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'internal error' });
  } finally {
    console.error = original;
    p.close();
  }
  // Not committed, so released for a retry.
  assert.equal((await post('/api-gateway/v2/liveness', multipart({ session_id: 'sess-mine' }, { video: 'v' }))).status, 200);
  assert.equal((await upstreamPart(received.at(-1))).phrase, challenge);
});

test('an authenticate that throws answers 401, not 502', async () => {
  const p = createProxy({
    apiKey: 'project-key', apiUrl: upstreamUrl, sessions, challenges, sweepIntervalMs: 0,
    authenticate: (req) => {
      if (req.headers.authorization !== 'Bearer app-token') throw new Error('jwt malformed');
      return 'user-123';
    },
  });
  const pUrl = await listen(p);
  const logged = [];
  const original = console.error;
  console.error = (err) => logged.push(err);
  try {
    let res = await fetch(`${pUrl}/api-gateway/v2/sessions`, { method: 'POST', headers: { authorization: 'Bearer expired' } });
    assert.equal(res.status, 401);
    res = await fetch(`${pUrl}/api-gateway/v2/sessions`, { method: 'POST', headers: { authorization: 'Bearer app-token' } });
    assert.equal(res.status, 200);
  } finally {
    console.error = original;
    p.close();
  }
  assert.equal(logged.length, 0);
});

test('an unreachable Biometry API answers 502', async () => {
  const p = createProxy({
    apiKey: 'project-key', apiUrl: 'http://127.0.0.1:1', authenticate: (req) => USERS[req.headers.authorization],
    sessions, challenges, sweepIntervalMs: 0,
  });
  const pUrl = await listen(p);
  const original = console.error;
  console.error = () => {};
  try {
    const res = await fetch(`${pUrl}/api-gateway/v2/sessions`, { method: 'POST', headers: APP_AUTH });
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'upstream error' });
  } finally {
    console.error = original;
    p.close();
  }
});

test('a Biometry call that takes too long gives 504 and leaves the challenge usable', async () => {
  const challenge = await issueChallenge();
  const slow = createProxy({
    apiKey: 'project-key', apiUrl: upstreamUrl, authenticate: (req) => USERS[req.headers.authorization],
    sessions, challenges, sweepIntervalMs: 0, upstreamTimeoutMs: 50,
  });
  const slowUrl = await listen(slow);
  let open;
  upstreamGate = new Promise((resolve) => { open = resolve; });
  try {
    const res = await fetch(`${slowUrl}/api-gateway/v2/liveness`, {
      method: 'POST', headers: APP_AUTH, body: multipart({ session_id: 'sess-mine' }, { video: 'v' }),
    });
    assert.equal(res.status, 504);
  } finally {
    open();
    upstreamGate = undefined;
    slow.close();
  }
  assert.equal((await post('/api-gateway/v2/liveness', multipart({ session_id: 'sess-mine' }, { video: 'v' }))).status, 200);
  assert.equal((await upstreamPart(received.at(-1))).phrase, challenge);
});

test('stores whose methods return Promises work', async () => {
  const asyncStore = (store) => new Proxy(store, {
    get: (target, key) => {
      const value = target[key];
      if (typeof value !== 'function') return value;
      return (...args) => {
        const result = value.apply(target, args);
        if (result && typeof result === 'object' && typeof result.commit === 'function') {
          return Promise.resolve({
            value: result.value,
            commit: async () => result.commit(),
            release: async () => result.release(),
          });
        }
        return Promise.resolve(result);
      };
    },
  });
  const proxy2 = createProxy({
    apiKey: 'project-key', apiUrl: upstreamUrl, authenticate: (req) => USERS[req.headers.authorization],
    sessions: asyncStore(sessions), challenges: asyncStore(challenges), sweepIntervalMs: 0,
  });
  const url2 = await listen(proxy2);
  try {
    const call = (path, body, headers = APP_AUTH) => fetch(`${url2}${path}`, { method: 'POST', headers, body });
    let res = await call('/challenge', JSON.stringify({ session_id: 'sess-mine' }), { ...APP_AUTH, 'content-type': 'application/json' });
    assert.equal(res.status, 200);
    const { challenge } = await res.json();
    res = await call('/api-gateway/v2/liveness', multipart({ session_id: 'sess-other' }, { video: 'v' }));
    assert.equal(res.status, 403);
    res = await call('/api-gateway/v2/liveness', multipart({ session_id: 'sess-mine' }, { video: 'v' }));
    assert.equal(res.status, 200);
    assert.equal((await upstreamPart(received[0])).phrase, challenge);
    res = await call('/api-gateway/v2/liveness', multipart({ session_id: 'sess-mine' }, { video: 'v' }));
    assert.equal(res.status, 409);
    nextResponse = { body: '{"data":{"session_id":"sess-async"},"meta":{}}' };
    res = await call('/api-gateway/v2/sessions', undefined);
    assert.equal(res.status, 200);
    assert.equal(sessions.owner('sess-async'), 'user-123');
  } finally {
    proxy2.close();
  }
});

test('a new challenge for the session replaces the old one and resets its uses', async () => {
  const first = await issueChallenge();
  assert.equal((await post('/api-gateway/v2/liveness', multipart({ session_id: 'sess-mine' }, { video: 'v' }))).status, 200);
  const second = await issueChallenge();
  assert.notEqual(second, undefined);
  const res = await post('/api-gateway/v2/liveness', multipart({ session_id: 'sess-mine', phrase: first }, { video: 'v' }));
  assert.equal(res.status, 200);
  assert.equal((await upstreamPart(received[1])).phrase, second);
});

test('issuing a challenge needs sign-in and an owned session, and is rate limited per user', async () => {
  let res = await postJson('/challenge', { session_id: 'sess-mine' }, {});
  assert.equal(res.status, 401);
  res = await postJson('/challenge', { session_id: 'sess-other' });
  assert.equal(res.status, 403);
  res = await postJson('/challenge', {});
  assert.equal(res.status, 400);

  for (let i = 0; i < 10; i++) await issueChallenge();
  res = await postJson('/challenge', { session_id: 'sess-mine' });
  assert.equal(res.status, 429);
  assert.ok(res.headers.get('retry-after'));
  await issueChallenge('sess-other', OTHER_AUTH); // other users are not affected
  clock += 60 * 1000;
  await issueChallenge(); // a new window
});

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

test('onboarding consent records authorization and storage consent server-side for the signed-in user', async () => {
  const res = await postJson('/onboarding/consent', { accepted: true, user_id: 'victim' });
  assert.equal(res.status, 200);
  assert.deepEqual(received.map((r) => `${r.method} ${r.url}`), ['PUT /api-gateway/v2/users/user-123/consents']);
  const [r] = received;
  assert.equal(r.headers.authorization, 'Bearer project-key');
  assert.deepEqual(JSON.parse(r.body.toString()), { authorization: true, storage: true });
  // Biometry's record of the consent shows the user's client, not this server.
  assert.ok(r.headers['x-forwarded-for']);
});

test('onboarding consent needs accepted: true, a signed-in user and a user_id of 3+ characters', async () => {
  let res = await postJson('/onboarding/consent', { accepted: 'yes' });
  assert.equal(res.status, 400);
  res = await postJson('/onboarding/consent', { accepted: true }, {});
  assert.equal(res.status, 401);
  res = await postJson('/onboarding/consent', { accepted: true }, SHORT_AUTH);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /3 to 128 characters/);
  assert.equal(received.length, 0);
  await assert.rejects(recordConsent({ apiUrl: upstreamUrl, apiKey: 'k', userId: 'ab' }), /3 to 128/);
  await assert.rejects(recordConsent({ apiUrl: upstreamUrl, apiKey: 'k', userId: 'a'.repeat(129) }), /3 to 128/);
});

test('a consent failure upstream gives 502', async () => {
  nextResponse = { status: 500, body: '{}' };
  const res = await postJson('/onboarding/consent', { accepted: true });
  assert.equal(res.status, 502);
  assert.equal(received.length, 1);
});

test('the proxy\'s own routes need a JSON body, so a cross-site form or text/plain POST is refused', async () => {
  for (const path of ['/onboarding/consent', '/challenge']) {
    const res = await post(path, JSON.stringify({ accepted: true, session_id: 'sess-mine' }), { ...APP_AUTH, 'content-type': 'text/plain' });
    assert.equal(res.status, 415, path);
  }
  assert.equal(received.length, 0);
});

test('browser requests from another origin are refused; the app origin, same host and no Origin are allowed', async () => {
  const host = new URL(proxyUrl).host;
  let res = await postJson('/onboarding/consent', { accepted: true }, { ...APP_AUTH, origin: 'https://evil.example' });
  assert.equal(res.status, 403);
  res = await post('/api-gateway/v2/face-verify', multipart({ session_id: 'sess-mine' }, { video: 'v' }), { ...APP_AUTH, origin: 'null' });
  assert.equal(res.status, 403);
  assert.equal(received.length, 0);
  res = await postJson('/onboarding/consent', { accepted: true }, { ...APP_AUTH, origin: 'https://app.example.com' });
  assert.equal(res.status, 200);
  res = await postJson('/onboarding/consent', { accepted: true }, { ...APP_AUTH, origin: `http://${host}` });
  assert.equal(res.status, 200);
  res = await postJson('/onboarding/consent', { accepted: true });
  assert.equal(res.status, 200);
});

test('a same-host Origin with a different scheme is refused', async () => {
  // The test proxy is plain http, so an https page on the same host is another site.
  const host = new URL(proxyUrl).host;
  let res = await postJson('/onboarding/consent', { accepted: true }, { ...APP_AUTH, origin: `https://${host}` });
  assert.equal(res.status, 403);
  // Without trustProxy a client-written x-forwarded-proto changes nothing.
  res = await postJson('/onboarding/consent', { accepted: true }, {
    ...APP_AUTH, origin: `https://${host}`, 'x-forwarded-proto': 'https',
  });
  assert.equal(res.status, 403);
  assert.equal(received.length, 0);
});

test('requestScheme reads x-forwarded-proto only behind a trusted proxy', () => {
  const req = (encrypted, xfp) => ({ socket: { encrypted }, headers: xfp ? { 'x-forwarded-proto': xfp } : {} });
  assert.equal(requestScheme(req(false), 0), 'http:');
  assert.equal(requestScheme(req(true), 0), 'https:');
  assert.equal(requestScheme(req(false, 'https'), 0), 'http:');
  // A TLS-terminating load balancer in front: the browser used https.
  assert.equal(requestScheme(req(false, 'https'), 1), 'https:');
  assert.equal(requestScheme(req(false, 'http, HTTPS'), 1), 'https:');
  assert.equal(requestScheme(req(true, 'http'), 1), 'http:');
  // Two appending proxies: the outer one saw https, the inner hop was http.
  assert.equal(requestScheme(req(false, 'https, http'), 2), 'https:');
  // A client-written entry left of the trusted ones is ignored.
  assert.equal(requestScheme(req(false, 'http, https, http'), 2), 'https:');
  // Two proxies that overwrite: one entry, set by the nearest.
  assert.equal(requestScheme(req(false, 'https'), 2), 'https:');
  // Anything else falls back to the socket.
  assert.equal(requestScheme(req(false, 'ftp'), 1), 'http:');
  assert.equal(requestScheme(req(false), 1), 'http:');
});

test('the SDK consent calls are not forwarded', async () => {
  for (const path of ['/api-consent/consent', '/api-consent/strg-consent']) {
    const res = await postJson(path, { is_consent_given: true, user_fullname: 'victim' });
    assert.equal(res.status, 404);
  }
  // giveConsent() / revokeConsent() in the SDKs: consent is recorded by the backend.
  for (const method of ['PUT', 'GET']) {
    const res = await fetch(`${proxyUrl}/api-gateway/v2/users/victim/consents`, {
      method,
      headers: { ...APP_AUTH, 'content-type': 'application/json' },
      body: method === 'PUT' ? JSON.stringify({ authorization: true, storage: true }) : undefined,
    });
    assert.equal(res.status, 404);
  }
  assert.equal(received.length, 0);
});
