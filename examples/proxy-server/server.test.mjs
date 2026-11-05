// Run with: node --test   (Node 18+, no dependencies)
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createProxy, ChallengeStore, generateChallenge, CHALLENGE_LENGTH, CHALLENGE_DIGITS } from './server.mjs';

const APP_AUTH = { authorization: 'Bearer demo-app-token' }; // demo user: user-123
const OTHER_AUTH = { authorization: 'Bearer other-app-token' }; // test user: victim

let upstream;
let upstreamUrl;
let received; // requests the fake Biometry API got
let nextResponse; // what the fake Biometry API answers next

let proxy;
let proxyUrl;
const sessionOwners = new Map();
let clock = 1_000_000;
const challenges = new ChallengeStore({ now: () => clock });

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
    const { status = 200, headers = { 'content-type': 'application/json' }, body = '{"data":{},"meta":{}}' } =
      nextResponse ?? {};
    res.writeHead(status, headers);
    res.end(body);
  });
  upstreamUrl = await listen(upstream);
  const users = { 'Bearer demo-app-token': 'user-123', 'Bearer other-app-token': 'victim' };
  proxy = createProxy({
    apiKey: 'project-key',
    apiUrl: upstreamUrl,
    authenticate: (req) => users[req.headers.authorization],
    sessionOwners,
    challenges,
    allowedOrigin: 'https://app.example.com',
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
  sessionOwners.clear();
  sessionOwners.set('sess-mine', 'user-123');
  sessionOwners.set('sess-other', 'victim');
  challenges.challenges.clear();
  challenges.issued.clear();
  clock = 1_000_000;
});

async function issueChallenge(headers = APP_AUTH) {
  const res = await fetch(`${proxyUrl}/challenge`, { method: 'POST', headers });
  assert.equal(res.status, 200);
  return (await res.json()).challenge;
}

/** Parses a multipart body the fake upstream received. */
async function upstreamForm(rec) {
  return new Request('http://local/', {
    method: 'POST', headers: { 'content-type': rec.headers['content-type'] }, body: rec.body,
  }).formData();
}

function multipart(requestPart, files = {}, extra = {}) {
  const form = new FormData();
  form.append('request', typeof requestPart === 'string' ? requestPart : JSON.stringify(requestPart));
  for (const [name, bytes] of Object.entries(files)) form.append(name, new Blob([bytes], { type: 'video/mp4' }), `${name}.mp4`);
  for (const [name, value] of Object.entries(extra)) form.append(name, value);
  return form;
}

function post(path, body, headers = APP_AUTH) {
  return fetch(`${proxyUrl}${path}`, { method: 'POST', headers, body });
}

test('case-variant and look-alike user_id keys never reach Biometry; user_id is set from the session', async () => {
  // Go's encoding/json matches keys case-insensitively and folds ſ to s, so a
  // proxy that only checked `user_id` and passed the body through could be fooled.
  const raw = '{"user_id":"user-123","USER_ID":"victim","uſer_id":"victim","User_Id":"victim"}';
  const res = await post('/api-gateway/v2/enrollments/face', multipart(raw, { face: 'img' }));
  assert.equal(res.status, 200);

  const form = await upstreamForm(received[0]);
  assert.equal(form.get('request'), JSON.stringify({ user_id: 'user-123' }));
});

test('a client-supplied user_id for someone else is replaced, not forwarded', async () => {
  const challenge = await issueChallenge();
  const res = await post('/api-gateway/v2/liveness', multipart({ user_id: 'victim' }, { video: 'v' }));
  assert.equal(res.status, 200);
  const part = JSON.parse((await upstreamForm(received[0])).get('request'));
  assert.deepEqual(part, { phrase: challenge, user_id: 'user-123' });
});

test('only allowed fields and files are forwarded, in a rebuilt multipart body', async () => {
  const challenge = await issueChallenge();
  const body = multipart(
    { session_id: 'sess-mine', phrase: 'one two', trigger: 'login', services: { exclude: ['voice_recognition'] }, phone_number: '+1', auto_enroll: true },
    { video: 'VIDEO-BYTES', document: 'not-for-this-route' },
    { phrase: 'form-field-injection', vocabulary: 'x' },
  );
  const res = await post('/api-gateway/v2/liveness', body);
  assert.equal(res.status, 200);

  const rec = received[0];
  const form = await upstreamForm(rec);
  assert.deepEqual([...form.keys()].sort(), ['request', 'video']);
  assert.deepEqual(JSON.parse(form.get('request')), {
    session_id: 'sess-mine', trigger: 'login', services: { exclude: ['voice_recognition'] }, phrase: challenge, user_id: 'user-123',
  });
  assert.equal(await form.get('video').text(), 'VIDEO-BYTES');
  assert.equal(rec.headers.authorization, 'Bearer project-key');
});

test('a session_id the user does not own is refused before Biometry is called', async () => {
  let res = await post('/api-gateway/v2/face-verify', multipart({ session_id: 'sess-other', phrase: 'one' }, { video: 'v' }));
  assert.equal(res.status, 403);
  res = await post('/api-gateway/v2/face-verify', multipart({ session_id: 'never-started' }, { video: 'v' }));
  assert.equal(res.status, 403);
  res = await post('/api-gateway/v2/sessions/sess-other/end', undefined);
  assert.equal(res.status, 403);
  assert.equal(received.length, 0);
});

test('wrong field types are refused', async () => {
  await issueChallenge();
  const res = await post('/api-gateway/v2/liveness', multipart({ trigger: ['login'] }, { video: 'v' }));
  assert.equal(res.status, 400);
  assert.equal(received.length, 0);
});

test('the query string is dropped, except warmup=true on session start', async () => {
  nextResponse = { body: '{"data":{"session_id":"sess-new"},"meta":{}}' };
  let res = await post('/api-gateway/v2/sessions?warmup=true&phrase=x&user_id=victim', undefined);
  assert.equal(res.status, 200);
  assert.equal(received[0].url, '/api-gateway/v2/sessions?warmup=true');
  assert.equal(sessionOwners.get('sess-new'), 'user-123');

  await issueChallenge();
  res = await post('/api-gateway/v2/liveness?phrase=x&vocabulary=y&trigger=z&is_document=true', multipart({}, { video: 'v' }));
  assert.equal(res.status, 200);
  assert.equal(received[1].url, '/api-gateway/v2/liveness');
});

test('session start forwards no client body', async () => {
  nextResponse = { body: '{"data":{"session_id":"sess-new"},"meta":{}}' };
  const res = await post('/api-gateway/v2/sessions', JSON.stringify({ user_id: 'victim' }), { ...APP_AUTH, 'content-type': 'application/json' });
  assert.equal(res.status, 200);
  assert.equal(received[0].body.length, 0);
});

test('a non-JSON 2xx from session start is passed back without crashing', async () => {
  nextResponse = { headers: { 'content-type': 'text/plain' }, body: 'ok' };
  const res = await post('/api-gateway/v2/sessions', undefined);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
});

test('end session forwards only phone_number', async () => {
  const res = await post(
    '/api-gateway/v2/sessions/sess-mine/end',
    JSON.stringify({ phone_number: '+15551234567', user_id: 'victim', USER_ID: 'victim' }),
    { ...APP_AUTH, 'content-type': 'application/json' },
  );
  assert.equal(res.status, 200);
  assert.equal(received[0].body.toString(), JSON.stringify({ phone_number: '+15551234567' }));
  assert.equal(received[0].headers['content-type'], 'application/json');
});

test('user_id in the path must be the signed-in user, and path ids must look like ids', async () => {
  let res = await post('/api-gateway/v2/consents/consent-1/approve/victim', undefined);
  assert.equal(res.status, 403);
  // URL parsing turns %2E%2E into a `..` segment, so this one never matches a route.
  res = await post('/api-gateway/v2/consents/%2E%2E/approve/user-123', undefined);
  assert.ok([400, 404].includes(res.status), String(res.status));
  res = await post('/api-gateway/v2/consents/a%2Fb/approve/user-123', undefined);
  assert.equal(res.status, 400);
  assert.equal(received.length, 0);

  res = await fetch(`${proxyUrl}/api-gateway/v2/consents/my-approvals/user-123`, { headers: APP_AUTH });
  assert.equal(res.status, 200);
  assert.equal(received[0].url, '/api-gateway/v2/consents/my-approvals/user-123');
});

test('unauthenticated callers get 401 and unknown paths 404', async () => {
  let res = await post('/api-gateway/v2/sessions', undefined, {});
  assert.equal(res.status, 401);
  res = await post('/api-gateway/v2/transactions', undefined);
  assert.equal(res.status, 404);
  res = await post('/api-consent/consent', undefined);
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
  assert.equal(res.headers.get('vary'), 'Origin');
});

// ---------------------------------------------------------------------------
// Liveness challenge
// ---------------------------------------------------------------------------

test('generateChallenge gives CHALLENGE_LENGTH distinct digits from CHALLENGE_DIGITS', () => {
  for (let i = 0; i < 200; i++) {
    const c = generateChallenge();
    assert.equal(c.length, CHALLENGE_LENGTH);
    assert.equal(new Set(c).size, CHALLENGE_LENGTH);
    for (const d of c) assert.ok(CHALLENGE_DIGITS.includes(d), c);
  }
});

test('the stored challenge overwrites the phrase the device sent, on all three calls', async () => {
  for (const [path, file] of [['liveness', 'video'], ['face-verify', 'video'], ['voice-verify', 'voice']]) {
    const challenge = await issueChallenge();
    const res = await post(`/api-gateway/v2/${path}`, multipart({ phrase: 'five two nine one seven three eight', PHRASE: '1234567' }, { [file]: 'v' }));
    assert.equal(res.status, 200, path);
    const part = JSON.parse((await upstreamForm(received.at(-1))).get('request'));
    assert.equal(part.phrase, challenge, path);
    assert.equal(Object.keys(part).filter((k) => k.toLowerCase() === 'phrase').length, 1);
  }
});

test('a challenge is single use', async () => {
  await issueChallenge();
  let res = await post('/api-gateway/v2/liveness', multipart({}, { video: 'v' }));
  assert.equal(res.status, 200);
  res = await post('/api-gateway/v2/face-verify', multipart({}, { video: 'v' }));
  assert.equal(res.status, 409);
  assert.equal(received.length, 1);
});

test('a missing challenge gives 409 and nothing is sent to Biometry', async () => {
  const res = await post('/api-gateway/v2/liveness', multipart({ phrase: '12345678' }, { video: 'v' }));
  assert.equal(res.status, 409);
  assert.equal(received.length, 0);
});

test('an expired challenge gives 409', async () => {
  await issueChallenge();
  clock += 5 * 60 * 1000;
  const res = await post('/api-gateway/v2/liveness', multipart({}, { video: 'v' }));
  assert.equal(res.status, 409);
  assert.equal(received.length, 0);
});

test('a challenge just inside its 5 minutes still works', async () => {
  await issueChallenge();
  clock += 5 * 60 * 1000 - 1;
  const res = await post('/api-gateway/v2/liveness', multipart({}, { video: 'v' }));
  assert.equal(res.status, 200);
});

test('a challenge issued to another user cannot be used', async () => {
  const victimsChallenge = await issueChallenge(OTHER_AUTH);
  const res = await post('/api-gateway/v2/liveness', multipart({ phrase: victimsChallenge, user_id: 'victim' }, { video: 'v' }));
  assert.equal(res.status, 409);
  assert.equal(received.length, 0);

  // The victim's own challenge is still there for the victim.
  const own = await fetch(`${proxyUrl}/api-gateway/v2/liveness`, { method: 'POST', headers: OTHER_AUTH, body: multipart({}, { video: 'v' }) });
  assert.equal(own.status, 200);
  assert.equal(JSON.parse((await upstreamForm(received[0])).get('request')).phrase, victimsChallenge);
});

test('a new challenge replaces the previous one', async () => {
  const first = await issueChallenge();
  const second = await issueChallenge();
  const res = await post('/api-gateway/v2/liveness', multipart({ phrase: first }, { video: 'v' }));
  assert.equal(res.status, 200);
  assert.equal(JSON.parse((await upstreamForm(received[0])).get('request')).phrase, second);
});

test('challenge issuance is rate limited per user and needs sign-in', async () => {
  for (let i = 0; i < 10; i++) await issueChallenge();
  let res = await fetch(`${proxyUrl}/challenge`, { method: 'POST', headers: APP_AUTH });
  assert.equal(res.status, 429);
  assert.ok(res.headers.get('retry-after'));
  await issueChallenge(OTHER_AUTH); // other users are not affected
  clock += 60 * 1000;
  await issueChallenge(); // a new window
  res = await fetch(`${proxyUrl}/challenge`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('voice enrollment keeps the phrase from the request (no challenge involved)', async () => {
  const res = await post('/api-gateway/v2/enrollments/voice', multipart({ phrase: 'one two three', vocabulary: 'en_digits' }, { voice: 'v' }));
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse((await upstreamForm(received[0])).get('request')), { phrase: 'one two three', vocabulary: 'en_digits', user_id: 'user-123' });
});

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

test('onboarding consent records authorization and storage consent server-side for the signed-in user', async () => {
  const res = await post('/onboarding/consent', JSON.stringify({ accepted: true, user_id: 'victim' }), { ...APP_AUTH, 'content-type': 'application/json' });
  assert.equal(res.status, 200);
  assert.deepEqual(received.map((r) => r.url), ['/api-consent/consent', '/api-consent/strg-consent']);
  for (const r of received) {
    assert.equal(r.headers.authorization, 'Bearer project-key');
    assert.deepEqual(JSON.parse(r.body.toString()), { is_consent_given: true, user_fullname: 'user-123' });
  }
});

test('onboarding consent needs accepted: true and a signed-in user', async () => {
  let res = await post('/onboarding/consent', JSON.stringify({ accepted: 'yes' }));
  assert.equal(res.status, 400);
  res = await post('/onboarding/consent', JSON.stringify({ accepted: true }), {});
  assert.equal(res.status, 401);
  assert.equal(received.length, 0);
});

test('a consent failure upstream is reported and storage consent is not attempted', async () => {
  nextResponse = { status: 500, body: '{}' };
  const res = await post('/onboarding/consent', JSON.stringify({ accepted: true }));
  assert.equal(res.status, 500);
  assert.equal(received.length, 1);
});

test('the SDK consent-service calls are not forwarded', async () => {
  for (const path of ['/api-consent/consent', '/api-consent/strg-consent']) {
    const res = await post(path, JSON.stringify({ is_consent_given: true, user_fullname: 'victim' }));
    assert.equal(res.status, 404);
  }
  assert.equal(received.length, 0);
});
