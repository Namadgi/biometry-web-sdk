import { BiometrySDK, BiometryApiError, DEFAULT_PROXY_PATHS } from '.';

// Mock the fetch API globally
global.fetch = jest.fn();

global.File = class File extends Blob {
  name: string;
  lastModified: number;
  webkitRelativePath: string;

  constructor(fileBits: BlobPart[], fileName: string, options: FilePropertyBag = { type: '' }) {
    super(fileBits, options);
    this.name = fileName;
    this.lastModified = options.lastModified || Date.now();
    this.webkitRelativePath = '';
  }
};

const BASE = 'https://api.biometrysolutions.com';
const V2 = `${BASE}/api-gateway/v2`;

/** Reads the JSON `request` part appended to a FormData spy. */
function requestPartFrom(spy: jest.SpyInstance): any {
  const call = spy.mock.calls.find(([field]) => field === 'request');
  return call ? JSON.parse(call[1] as string) : undefined;
}

function mockOk(body: any, headerEntries: Record<string, string> = {}) {
  const headers = new Headers();
  Object.entries(headerEntries).forEach(([k, v]) => headers.set(k, v));
  (fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => body,
    headers,
  });
}

function mockErr(status: number, body: any) {
  (fetch as jest.Mock).mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => body,
    headers: new Headers(),
  });
}

describe('BiometrySDK', () => {
  const apiKey = 'test-api-key';
  const sdk = new BiometrySDK(apiKey);

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should throw an error if no API key is provided', () => {
    expect(() => new BiometrySDK('')).toThrow('API Key is required to initialize the SDK.');
  });

  // SESSIONS
  it('should start a session and return the envelope', async () => {
    const mockResponse = { data: { session_id: 'sess-1' }, meta: { request_id: 'r1' } };
    mockOk(mockResponse);

    const result = await sdk.startSession();

    expect(fetch).toHaveBeenCalledWith(
      `${V2}/sessions`,
      expect.objectContaining({ method: 'POST', headers: { Authorization: `Bearer ${apiKey}` } })
    );
    expect(result.body).toEqual(mockResponse);
  });

  it('should append warmup=true when requested', async () => {
    mockOk({ data: { session_id: 'sess-1' }, meta: {} });
    await sdk.startSession({ warmup: true });
    expect(fetch).toHaveBeenCalledWith(`${V2}/sessions?warmup=true`, expect.any(Object));
  });

  it('should end a session with a phone number body', async () => {
    mockOk({ meta: { request_id: 'r1' } });
    await sdk.endSession('sess-1', { phoneNumber: '+15551234567' });

    expect(fetch).toHaveBeenCalledWith(
      `${V2}/sessions/sess-1/end`,
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number: '+15551234567' }),
      })
    );
  });

  it('should throw if session id is missing on end', async () => {
    await expect(sdk.endSession('')).rejects.toThrow('Session ID is required.');
  });

  // AUTHORIZATION CONSENT (unchanged, consent service)
  it('should call the consent service when giving authorization consent', async () => {
    const mockResponse = { data: { is_consent_given: true, user_fullname: 'John Doe' } };
    mockOk(mockResponse);

    const result = await sdk.giveAuthorizationConsent(true, 'John Doe');

    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api-consent/consent`,
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_consent_given: true, user_fullname: 'John Doe' }),
      })
    );
    expect(result).toEqual({ body: mockResponse, headers: {} });
  });

  it('should surface the legacy string error shape from the consent service', async () => {
    mockErr(400, { error: 'is_consent_given must be true' });
    await expect(sdk.giveAuthorizationConsent(true, 'John Doe'))
      .rejects.toThrow('Error 400: is_consent_given must be true');
  });

  it('should call the consent service when giving storage consent', async () => {
    const mockResponse = { data: { is_consent_given: true, user_fullname: 'John Doe' } };
    mockOk(mockResponse);

    await sdk.giveStorageConsent(true, 'John Doe');

    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api-consent/strg-consent`,
      expect.objectContaining({ method: 'POST' })
    );
  });

  // VOICE ENROLLMENT
  it('should throw an error if user id is missing (voice)', async () => {
    const audioFile = new File(['audio data'], 'audio.wav', { type: 'audio/wav' });
    await expect(sdk.enrollVoice(audioFile, '', 'phrase')).rejects.toThrowError('User ID is required.');
  });

  it('should throw an error if phrase is missing (voice)', async () => {
    const audioFile = new File(['audio data'], 'audio.wav', { type: 'audio/wav' });
    await expect(sdk.enrollVoice(audioFile, 'user-1', '')).rejects.toThrowError('Phrase is required.');
  });

  it('should throw an error if audio file is missing', async () => {
    await expect(sdk.enrollVoice(null as unknown as File, 'user-1', 'phrase')).rejects.toThrowError('Audio file is required.');
  });

  it('should enroll voice with the v2 request part', async () => {
    const mockResponse = { data: { enrolled: true, user_id: 'user-1' }, meta: { request_id: 'r1' } };
    mockOk(mockResponse);

    const audioFile = new File(['audio data'], 'audio.wav', { type: 'audio/wav' });
    const formDataSpy = jest.spyOn(FormData.prototype, 'append');
    const result = await sdk.enrollVoice(audioFile, 'user-1', 'one two three', { vocabulary: 'en_digits' });

    expect(requestPartFrom(formDataSpy)).toEqual({ user_id: 'user-1', phrase: 'one two three', vocabulary: 'en_digits' });
    expect(formDataSpy).toHaveBeenCalledWith('voice', audioFile);
    expect(fetch).toHaveBeenCalledWith(
      `${V2}/enrollments/voice`,
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: expect.any(FormData),
      })
    );
    expect(result.body).toEqual(mockResponse);
  });

  // FACE ENROLLMENT
  it('should throw an error if user id is missing (face)', async () => {
    const imageFile = new File(['image data'], 'image.jpg', { type: 'image/jpeg' });
    await expect(sdk.enrollFace(imageFile, '')).rejects.toThrowError('User ID is required.');
  });

  it('should throw an error if image file is missing', async () => {
    await expect(sdk.enrollFace(null as unknown as File, 'user-1')).rejects.toThrowError('Face image is required.');
  });

  it('should enroll face and pass is_document through the request part', async () => {
    const mockResponse = { data: { enrolled: true, user_id: 'user-1' }, meta: {} };
    mockOk(mockResponse, { 'x-request-id': 'test-request-id' });

    const imageFile = new File(['image data'], 'image.jpg', { type: 'image/jpeg' });
    const formDataSpy = jest.spyOn(FormData.prototype, 'append');
    const result = await sdk.enrollFace(imageFile, 'user-1', { isDocument: true });

    expect(requestPartFrom(formDataSpy)).toEqual({ user_id: 'user-1', is_document: true });
    expect(formDataSpy).toHaveBeenCalledWith('face', imageFile);
    expect(fetch).toHaveBeenCalledWith(`${V2}/enrollments/face`, expect.objectContaining({ method: 'POST' }));
    expect(result.headers).toEqual({ 'x-request-id': 'test-request-id' });
  });

  it('should omit is_document when not a document', async () => {
    mockOk({ data: { enrolled: true, user_id: 'user-1' }, meta: {} });
    const imageFile = new File(['image data'], 'image.jpg', { type: 'image/jpeg' });
    const formDataSpy = jest.spyOn(FormData.prototype, 'append');
    await sdk.enrollFace(imageFile, 'user-1');
    expect(requestPartFrom(formDataSpy)).toEqual({ user_id: 'user-1' });
  });

  // DOC AUTH
  it('should check document authenticity with provider fields', async () => {
    const mockResponse = { data: { first_name: 'John', last_name: 'Doe' }, meta: {} };
    mockOk(mockResponse);

    const docFile = new File(['doc data'], 'doc.jpg', { type: 'image/jpeg' });
    const formDataSpy = jest.spyOn(FormData.prototype, 'append');
    await sdk.checkDocAuth(docFile, { provider: 'idscan', mrzProvider: 'inhouse', sessionId: 'sess-1' });

    expect(requestPartFrom(formDataSpy)).toEqual({ session_id: 'sess-1', provider: 'idscan', mrz_provider: 'inhouse' });
    expect(formDataSpy).toHaveBeenCalledWith('document', docFile);
    expect(fetch).toHaveBeenCalledWith(`${V2}/documents/check`, expect.objectContaining({ method: 'POST' }));
  });

  it('should throw if document is missing', async () => {
    await expect(sdk.checkDocAuth(null as unknown as File)).rejects.toThrowError('Document image is required.');
  });

  // FACE MATCH
  it('should throw an error if reference image is missing', async () => {
    await expect(sdk.matchFaces(null as unknown as File, 'user-1')).rejects.toThrowError('Reference image is required.');
  });

  it('should throw an error if user id is missing (match)', async () => {
    const imageFile = new File(['image data'], 'image.jpg', { type: 'image/jpeg' });
    await expect(sdk.matchFaces(imageFile, '')).rejects.toThrowError('User ID is required.');
  });

  it('should throw an error if video is missing and not reusing session video', async () => {
    const imageFile = new File(['image data'], 'image.jpg', { type: 'image/jpeg' });
    await expect(sdk.matchFaces(imageFile, 'user-1')).rejects.toThrowError('Video is required.');
  });

  it('should require a session id when reusing session video', async () => {
    const imageFile = new File(['image data'], 'image.jpg', { type: 'image/jpeg' });
    await expect(sdk.matchFaces(imageFile, 'user-1', { useSessionVideo: true }))
      .rejects.toThrowError('Session ID is required to reuse the session video.');
  });

  it('should match faces with reference_image and video parts', async () => {
    const mockResponse = { data: { face_recognition: { score: 0.99 } }, decision: { status: 'pass' }, meta: {} };
    mockOk(mockResponse);

    const imageFile = new File(['image data'], 'image.jpg', { type: 'image/jpeg' });
    const videoFile = new File(['video data'], 'video.mp4', { type: 'video/mp4' });
    const formDataSpy = jest.spyOn(FormData.prototype, 'append');
    const result = await sdk.matchFaces(imageFile, 'user-1', { video: videoFile });

    expect(requestPartFrom(formDataSpy)).toEqual({ user_id: 'user-1' });
    expect(formDataSpy).toHaveBeenCalledWith('reference_image', imageFile);
    expect(formDataSpy).toHaveBeenCalledWith('video', videoFile);
    expect(fetch).toHaveBeenCalledWith(`${V2}/face-match`, expect.objectContaining({ method: 'POST' }));
    expect(result.body).toEqual(mockResponse);
  });

  it('should match faces reusing the session video', async () => {
    mockOk({ data: {}, meta: {} });
    const imageFile = new File(['image data'], 'image.jpg', { type: 'image/jpeg' });
    const formDataSpy = jest.spyOn(FormData.prototype, 'append');
    await sdk.matchFaces(imageFile, 'user-1', { useSessionVideo: true, sessionId: 'sess-1' });

    expect(requestPartFrom(formDataSpy)).toEqual({ user_id: 'user-1', session_id: 'sess-1', use_session_video: true });
    expect(formDataSpy).not.toHaveBeenCalledWith('video', expect.anything());
  });

  // SESSION VIDEO ON FACE-VERIFY / VOICE-VERIFY (BM-535 media binding)
  it('should face-verify reusing the session video without a file', async () => {
    mockOk({ data: {}, meta: {} });
    const formDataSpy = jest.spyOn(FormData.prototype, 'append');
    await sdk.faceVerify(null, 'user-1', undefined, { sessionId: 'sess-1', useSessionVideo: true });

    expect(requestPartFrom(formDataSpy)).toEqual({ user_id: 'user-1', session_id: 'sess-1', use_session_video: true });
    expect(formDataSpy).not.toHaveBeenCalledWith('video', expect.anything());
    expect(fetch).toHaveBeenCalledWith(`${V2}/face-verify`, expect.objectContaining({ method: 'POST' }));
  });

  it('should voice-verify reusing the session video without a file', async () => {
    mockOk({ data: {}, meta: {} });
    const formDataSpy = jest.spyOn(FormData.prototype, 'append');
    await sdk.voiceVerify(null, 'user-1', 'one two', { sessionId: 'sess-1', useSessionVideo: true });

    expect(requestPartFrom(formDataSpy)).toEqual({
      user_id: 'user-1', phrase: 'one two', session_id: 'sess-1', use_session_video: true,
    });
    expect(formDataSpy).not.toHaveBeenCalledWith('voice', expect.anything());
    expect(fetch).toHaveBeenCalledWith(`${V2}/voice-verify`, expect.objectContaining({ method: 'POST' }));
  });

  it('should not send the file when reusing the session video even if one is given', async () => {
    mockOk({ data: {}, meta: {} });
    const videoFile = new File(['video data'], 'video.mp4', { type: 'video/mp4' });
    const formDataSpy = jest.spyOn(FormData.prototype, 'append');
    await sdk.voiceVerify(videoFile, 'user-1', 'one two', { sessionId: 'sess-1', useSessionVideo: true });

    expect(formDataSpy).not.toHaveBeenCalledWith('voice', expect.anything());
  });

  it('should require a session id to reuse the session video on face-verify and voice-verify', async () => {
    await expect(sdk.faceVerify(null, 'user-1', undefined, { useSessionVideo: true }))
      .rejects.toThrowError('Session ID is required to reuse the session video.');
    await expect(sdk.voiceVerify(null, 'user-1', 'one two', { useSessionVideo: true }))
      .rejects.toThrowError('Session ID is required to reuse the session video.');
  });

  it('should still require a file on face-verify and voice-verify without useSessionVideo', async () => {
    await expect(sdk.faceVerify(null, 'user-1', undefined, { sessionId: 'sess-1' }))
      .rejects.toThrowError('Video is required.');
    await expect(sdk.voiceVerify(null, 'user-1', 'one two', { sessionId: 'sess-1' }))
      .rejects.toThrowError('Voice file is required.');
  });

  // LIVENESS / FACE-VERIFY / VOICE-VERIFY
  it('should throw if liveness video is missing', async () => {
    await expect(sdk.liveness(null as unknown as File, 'user-1', 'one two')).rejects.toThrowError('Video is required.');
  });

  it('should call liveness with excluded services', async () => {
    const mockResponse = { data: { face_liveness_detection: {} }, meta: {} };
    mockOk(mockResponse, { 'x-request-id': 'test-request-id' });

    const videoFile = new File(['video data'], 'video.mp4', { type: 'video/mp4' });
    const formDataSpy = jest.spyOn(FormData.prototype, 'append');
    const result = await sdk.liveness(videoFile, 'user-1', 'one two three', {
      trigger: 'authentication',
      excludeServices: ['voice_recognition', 'face_recognition'],
    });

    expect(requestPartFrom(formDataSpy)).toEqual({
      user_id: 'user-1',
      phrase: 'one two three',
      trigger: 'authentication',
      services: { exclude: ['voice_recognition', 'face_recognition'] },
    });
    expect(formDataSpy).toHaveBeenCalledWith('video', videoFile);
    expect(fetch).toHaveBeenCalledWith(`${V2}/liveness`, expect.objectContaining({ method: 'POST' }));
    expect(result.headers).toEqual({ 'x-request-id': 'test-request-id' });
  });

  it('should call face-verify with the video part', async () => {
    mockOk({ data: { face_recognition: {} }, meta: {} });
    const videoFile = new File(['video data'], 'video.mp4', { type: 'video/mp4' });
    const formDataSpy = jest.spyOn(FormData.prototype, 'append');
    await sdk.faceVerify(videoFile, 'user-1', 'one two', { sessionId: 'sess-1' });

    expect(requestPartFrom(formDataSpy)).toEqual({ user_id: 'user-1', phrase: 'one two', session_id: 'sess-1' });
    expect(formDataSpy).toHaveBeenCalledWith('video', videoFile);
    expect(fetch).toHaveBeenCalledWith(`${V2}/face-verify`, expect.objectContaining({ method: 'POST' }));
  });

  it('should call face-verify without a phrase field when no phrase is given', async () => {
    mockOk({ data: { face_recognition: {} }, meta: {} });
    const videoFile = new File(['video data'], 'video.mp4', { type: 'video/mp4' });
    const formDataSpy = jest.spyOn(FormData.prototype, 'append');
    await sdk.faceVerify(videoFile, 'user-1', undefined, { sessionId: 'sess-1' });

    const part = requestPartFrom(formDataSpy);
    expect(part).toEqual({ user_id: 'user-1', session_id: 'sess-1' });
    expect(part).not.toHaveProperty('phrase');
    expect(formDataSpy).toHaveBeenCalledWith('video', videoFile);
  });

  it('should call face-verify with only video and user id, and treat an empty phrase as absent', async () => {
    const videoFile = new File(['video data'], 'video.mp4', { type: 'video/mp4' });
    const formDataSpy = jest.spyOn(FormData.prototype, 'append');

    mockOk({ data: { face_recognition: {} }, meta: {} });
    await sdk.faceVerify(videoFile, 'user-1');
    expect(requestPartFrom(formDataSpy)).toEqual({ user_id: 'user-1' });

    formDataSpy.mockClear();
    mockOk({ data: { face_recognition: {} }, meta: {} });
    await sdk.faceVerify(videoFile, 'user-1', '');
    expect(requestPartFrom(formDataSpy)).toEqual({ user_id: 'user-1' });
  });

  it('should still require video and user id for face-verify', async () => {
    const videoFile = new File(['video data'], 'video.mp4', { type: 'video/mp4' });
    await expect(sdk.faceVerify(undefined as unknown as File, 'user-1')).rejects.toThrow('Video is required.');
    await expect(sdk.faceVerify(videoFile, '')).rejects.toThrow('User ID is required.');
  });

  it('should call voice-verify with the voice part', async () => {
    mockOk({ data: { voice_recognition: {} }, meta: {} });
    const voiceFile = new File(['voice data'], 'voice.wav', { type: 'audio/wav' });
    const formDataSpy = jest.spyOn(FormData.prototype, 'append');
    await sdk.voiceVerify(voiceFile, 'user-1', 'one two');

    expect(requestPartFrom(formDataSpy)).toEqual({ user_id: 'user-1', phrase: 'one two' });
    expect(formDataSpy).toHaveBeenCalledWith('voice', voiceFile);
    expect(fetch).toHaveBeenCalledWith(`${V2}/voice-verify`, expect.objectContaining({ method: 'POST' }));
  });

  // ERROR ENVELOPE
  it('should parse the v2 error envelope into a BiometryApiError', async () => {
    mockErr(422, { error: { code: 'face_not_detected', message: 'No face detected in the video.' }, meta: { request_id: 'r9' } });

    const videoFile = new File(['video data'], 'video.mp4', { type: 'video/mp4' });
    await expect(sdk.liveness(videoFile, 'user-1', 'one two')).rejects.toMatchObject({
      name: 'BiometryApiError',
      status: 422,
      code: 'face_not_detected',
      message: 'Error 422 [face_not_detected]: No face detected in the video.',
      meta: { request_id: 'r9' },
    });
  });

  it('should stringify a field-error array message', async () => {
    mockErr(400, { error: { code: 'invalid_request', message: [{ field: 'user_id', message: 'required' }] }, meta: {} });

    const imageFile = new File(['image data'], 'image.jpg', { type: 'image/jpeg' });
    const videoFile = new File(['video data'], 'video.mp4', { type: 'video/mp4' });
    await expect(sdk.matchFaces(imageFile, 'user-1', { video: videoFile })).rejects.toMatchObject({
      status: 400,
      code: 'invalid_request',
      message: `Error 400 [invalid_request]: ${JSON.stringify([{ field: 'user_id', message: 'required' }])}`,
    });
  });
});

describe('BiometrySDK proxy mode (baseUrl)', () => {
  const PROXY = 'https://app.example.com/biometry';

  afterEach(() => {
    jest.clearAllMocks();
  });

  function lastInit(): RequestInit {
    const calls = (fetch as jest.Mock).mock.calls;
    return calls[calls.length - 1][1];
  }

  it('still requires an API key when no baseUrl is given', () => {
    expect(() => new BiometrySDK({})).toThrow('apiKey or baseUrl is required to initialize the SDK.');
    expect(() => new BiometrySDK({ apiKey: '' })).toThrow('apiKey or baseUrl is required to initialize the SDK.');
  });

  it.each(['app.example.com', '/biometry', 'ftp://app.example.com', 'https://app.example.com?x=1', 'https://app.example.com#x', 'https://app.example.com/?', 'https://app.example.com/#'])(
    'rejects baseUrl %p that is not an absolute http(s) URL',
    (baseUrl) => {
      expect(() => new BiometrySDK({ baseUrl })).toThrow(/baseUrl must be an absolute http or https URL/);
    }
  );

  it('accepts an http baseUrl for local development', async () => {
    const sdk = new BiometrySDK({ baseUrl: 'http://localhost:3002' });
    mockOk({ data: { session_id: 's' }, meta: {} });
    await sdk.startSession();
    expect(fetch).toHaveBeenCalledWith('http://localhost:3002/sessions', expect.any(Object));
  });

  it('accepts the options form with only an apiKey and keeps direct-mode behaviour', async () => {
    const sdk = new BiometrySDK({ apiKey: 'k1' });
    mockOk({ data: { session_id: 's' }, meta: {} });
    await sdk.startSession();

    expect(fetch).toHaveBeenCalledWith(`${V2}/sessions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer k1' },
      body: undefined,
    });
  });

  it('sends requests to baseUrl with no Authorization header when no apiKey is set', async () => {
    const sdk = new BiometrySDK({ baseUrl: PROXY });
    mockOk({ data: { session_id: 's' }, meta: {} });
    await sdk.startSession({ warmup: true });

    expect(fetch).toHaveBeenCalledWith(`${PROXY}/sessions?warmup=true`, expect.any(Object));
    const headers = lastInit().headers as Record<string, string>;
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('authorization');
    expect(lastInit()).not.toHaveProperty('credentials');
  });

  it('strips trailing slashes from baseUrl', async () => {
    const sdk = new BiometrySDK({ baseUrl: `${PROXY}//` });
    mockOk({ meta: {} });
    await sdk.endSession('sess-1');
    expect(fetch).toHaveBeenCalledWith(`${PROXY}/sessions/sess-1/end`, expect.any(Object));
  });

  it('trims a long run of slashes quickly and keeps inner slashes', async () => {
    const slashes = '/'.repeat(100_000);
    const started = Date.now();
    const sdk = new BiometrySDK({ baseUrl: `${PROXY}/a${slashes}b${slashes}` });
    expect(Date.now() - started).toBeLessThan(1000);
    mockOk({ meta: {} });
    await sdk.endSession('sess-1');
    expect(fetch).toHaveBeenCalledWith(`${PROXY}/a${slashes}b/sessions/sess-1/end`, expect.any(Object));
  });

  it('sends every call to its default proxy path, without the /api-gateway/v2 prefix', async () => {
    const sdk = new BiometrySDK({ baseUrl: PROXY });
    const file = (name: string) => new File(['x'], name, { type: 'application/octet-stream' });
    const calls: Array<[() => Promise<unknown>, string]> = [
      [() => sdk.startSession(), '/sessions'],
      [() => sdk.endSession('sess-1'), '/sessions/sess-1/end'],
      [() => sdk.liveness(file('v.mp4'), 'user-1', 'one two'), '/liveness'],
      [() => sdk.faceVerify(file('v.mp4'), 'user-1', 'one two'), '/face-verify'],
      [() => sdk.voiceVerify(file('a.wav'), 'user-1', 'one two'), '/voice-verify'],
      [() => sdk.matchFaces(file('r.jpg'), 'user-1', { video: file('v.mp4') }), '/face-match'],
      [() => sdk.enrollFace(file('f.jpg'), 'user-1'), '/enrollments/face'],
      [() => sdk.enrollVoice(file('a.wav'), 'user-1', 'one two'), '/enrollments/voice'],
      [() => sdk.checkDocAuth(file('d.jpg')), '/documents/check'],
    ];
    for (const [call, path] of calls) {
      mockOk({ data: {}, meta: {} });
      await call();
      expect(fetch).toHaveBeenLastCalledWith(`${PROXY}${path}`, expect.objectContaining({ method: 'POST' }));
    }
  });

  it('exports the default proxy paths', () => {
    expect(DEFAULT_PROXY_PATHS).toEqual({
      startSession: '/sessions',
      endSession: '/sessions/{session_id}/end',
      liveness: '/liveness',
      faceVerify: '/face-verify',
      voiceVerify: '/voice-verify',
      faceMatch: '/face-match',
      enrollFace: '/enrollments/face',
      enrollVoice: '/enrollments/voice',
      checkDocument: '/documents/check',
    });
    expect(Object.isFrozen(DEFAULT_PROXY_PATHS)).toBe(true);
  });

  it('uses path overrides, fills placeholders URI-encoded, and keeps the other defaults', async () => {
    const sdk = new BiometrySDK({
      baseUrl: PROXY,
      paths: { endSession: '/my-sessions/{session_id}/finish', liveness: '/checks/liveness', startSession: '/my-sessions' },
    });

    mockOk({ meta: {} });
    await sdk.endSession('a/b c');
    expect(fetch).toHaveBeenLastCalledWith(`${PROXY}/my-sessions/a%2Fb%20c/finish`, expect.any(Object));

    mockOk({ data: {}, meta: {} });
    await sdk.liveness(new File(['v'], 'v.mp4', { type: 'video/mp4' }), 'user-1', 'one two');
    expect(fetch).toHaveBeenLastCalledWith(`${PROXY}/checks/liveness`, expect.any(Object));

    mockOk({ data: { session_id: 's' }, meta: {} });
    await sdk.startSession({ warmup: true });
    expect(fetch).toHaveBeenLastCalledWith(`${PROXY}/my-sessions?warmup=true`, expect.any(Object));

    mockOk({ data: {}, meta: {} });
    await sdk.faceVerify(new File(['v'], 'v.mp4', { type: 'video/mp4' }), 'user-1', 'one two');
    expect(fetch).toHaveBeenLastCalledWith(`${PROXY}/face-verify`, expect.any(Object));
  });

  it('sends face-verify without a phrase in proxy mode', async () => {
    const sdk = new BiometrySDK({ baseUrl: PROXY });
    const formDataSpy = jest.spyOn(FormData.prototype, 'append');
    mockOk({ data: {}, meta: {} });
    await sdk.faceVerify(new File(['v'], 'v.mp4', { type: 'video/mp4' }), 'user-1', undefined, { sessionId: 'sess-1' });
    expect(fetch).toHaveBeenLastCalledWith(`${PROXY}/face-verify`, expect.objectContaining({ method: 'POST' }));
    expect(requestPartFrom(formDataSpy)).toEqual({ user_id: 'user-1', session_id: 'sess-1' });
  });

  it('URI-encodes the session id in the default endSession path', async () => {
    const sdk = new BiometrySDK({ baseUrl: PROXY });
    mockOk({ meta: {} });
    await sdk.endSession('../x?y');
    expect(fetch).toHaveBeenLastCalledWith(`${PROXY}/sessions/..%2Fx%3Fy/end`, expect.any(Object));
  });

  it.each([
    [{ liveness: 'liveness' }, /paths\.liveness must be a string that starts with "\/"/],
    [{ liveness: '' }, /paths\.liveness must be a string that starts with "\/"/],
    [{ liveness: 42 }, /paths\.liveness must be a string that starts with "\/"/],
    [{ liveness: '/liveness?x=1' }, /paths\.liveness must not contain "\?" or "#"/],
    [{ liveness: '/liveness#x' }, /paths\.liveness must not contain "\?" or "#"/],
    [{ endSession: '/sessions/end' }, /paths\.endSession must contain exactly \{session_id\} once each/],
    [{ endSession: '/sessions/{id}/end' }, /paths\.endSession must contain exactly \{session_id\} once each/],
    [{ endSession: '/s/{session_id}/{session_id}' }, /paths\.endSession must contain exactly \{session_id\} once each/],
    [{ endSession: '/s/{session_id}/{user_id}' }, /paths\.endSession must contain exactly \{session_id\} once each/],
    [{ endSession: '/s/{session_id/end' }, /paths\.endSession must contain exactly \{session_id\} once each/],
    [{ liveness: '/liveness/{user_id}' }, /paths\.liveness must contain exactly no placeholders/],
    [{ deepfakeCheck: '/deepfake' }, /paths\.deepfakeCheck is not a known SDK call/],
    [{ checkDocAuth: '/docs' }, /paths\.checkDocAuth is not a known SDK call/],
  ])('rejects the invalid paths override %p', (paths, message) => {
    expect(() => new BiometrySDK({ baseUrl: PROXY, paths: paths as any })).toThrow(message);
  });

  it('rejects paths that is not an object', () => {
    expect(() => new BiometrySDK({ baseUrl: PROXY, paths: ['/x'] as any })).toThrow(/paths must be an object/);
  });

  it('ignores an undefined paths entry', async () => {
    const sdk = new BiometrySDK({ baseUrl: PROXY, paths: { liveness: undefined } });
    mockOk({ data: {}, meta: {} });
    await sdk.liveness(new File(['v'], 'v.mp4', { type: 'video/mp4' }), 'user-1', 'one two');
    expect(fetch).toHaveBeenLastCalledWith(`${PROXY}/liveness`, expect.any(Object));
  });

  it('ignores paths without baseUrl, with a console warning, and does not validate them', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const sdk = new BiometrySDK({ apiKey: 'k1', paths: { endSession: 'not-a-path', bogus: '/x' } as any });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/`paths` only applies with `baseUrl`/);

    mockOk({ meta: {} });
    await sdk.endSession('sess-1');
    expect(fetch).toHaveBeenLastCalledWith(`${V2}/sessions/sess-1/end`, expect.any(Object));
  });

  it.each([
    ['giveAuthorizationConsent', (sdk: BiometrySDK) => sdk.giveAuthorizationConsent(true, 'user-1')],
    ['giveStorageConsent', (sdk: BiometrySDK) => sdk.giveStorageConsent(true, 'user-1')],
  ])('%s throws in proxy mode without calling fetch', async (name, call) => {
    const sdk = new BiometrySDK({ apiKey: 'k1', baseUrl: PROXY });
    await expect(call(sdk)).rejects.toThrow(`${name} is not available in proxy mode: your backend records consent.`);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends static custom headers on every request', async () => {
    const sdk = new BiometrySDK({ baseUrl: PROXY, headers: { 'X-App-Session': 'abc' } });
    mockOk({ meta: {} });
    await sdk.endSession('sess-1', { phoneNumber: '+15551234567' });

    expect(lastInit().headers).toEqual({ 'X-App-Session': 'abc', 'Content-Type': 'application/json' });
  });

  it('calls a header function per request so app tokens can refresh', async () => {
    let n = 0;
    const sdk = new BiometrySDK({
      baseUrl: PROXY,
      headers: async () => ({ Authorization: `Bearer app-jwt-${++n}` }),
    });

    mockOk({ data: { session_id: 's' }, meta: {} });
    await sdk.startSession();
    expect(lastInit().headers).toEqual({ Authorization: 'Bearer app-jwt-1' });

    mockOk({ data: { session_id: 's' }, meta: {} });
    await sdk.startSession();
    expect(lastInit().headers).toEqual({ Authorization: 'Bearer app-jwt-2' });
  });

  it('lets custom headers replace the apiKey Authorization header', async () => {
    const sdk = new BiometrySDK({ apiKey: 'k1', baseUrl: PROXY, headers: { Authorization: 'Bearer other' } });
    mockOk({ data: { session_id: 's' }, meta: {} });
    await sdk.startSession();
    expect(lastInit().headers).toEqual({ Authorization: 'Bearer other' });
  });

  it('replaces SDK headers case-insensitively instead of sending both', async () => {
    const sdk = new BiometrySDK({ apiKey: 'k1', baseUrl: PROXY, headers: { authorization: 'Bearer other', 'x-app': 'a' } });
    mockOk({ meta: {} });
    await sdk.endSession('sess-1', { phoneNumber: '+15551234567' });
    expect(lastInit().headers).toEqual({ authorization: 'Bearer other', 'x-app': 'a', 'Content-Type': 'application/json' });
  });

  it('keeps Content-Type tied to the body: custom values are dropped for JSON and FormData', async () => {
    const sdk = new BiometrySDK({ baseUrl: PROXY, headers: { 'content-type': 'text/plain' } });
    mockOk({ meta: {} });
    await sdk.endSession('sess-1', { phoneNumber: '+15551234567' });
    expect(lastInit().headers).toEqual({ 'Content-Type': 'application/json' });

    mockOk({ data: {}, meta: {} });
    await sdk.liveness(new File(['v'], 'v.mp4', { type: 'video/mp4' }), 'user-1', '12345678');
    expect(lastInit().headers).toEqual({});
    expect(lastInit().body).toBeInstanceOf(FormData);
  });

  it('trims whitespace around baseUrl', async () => {
    const sdk = new BiometrySDK({ baseUrl: `  ${PROXY}/ \n` });
    mockOk({ meta: {} });
    await sdk.endSession('sess-1');
    expect(fetch).toHaveBeenCalledWith(`${PROXY}/sessions/sess-1/end`, expect.any(Object));
  });

  it('ignores headers and credentials in direct mode, with one console warning', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const headerFn = jest.fn(() => ({ Authorization: 'Bearer app-jwt' }));
    const sdk = new BiometrySDK({ apiKey: 'k1', headers: headerFn, credentials: 'include' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/only apply with `baseUrl`/);

    mockOk({ data: { session_id: 's' }, meta: {} });
    await sdk.startSession();
    mockOk({ data: { session_id: 's' }, meta: {} });
    await sdk.startSession();
    expect(fetch).toHaveBeenLastCalledWith(`${V2}/sessions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer k1' },
      body: undefined,
    });
    expect(headerFn).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not warn in direct mode without headers, credentials or paths, or in proxy mode', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    new BiometrySDK('k1');
    new BiometrySDK({ apiKey: 'k1' });
    new BiometrySDK({ baseUrl: PROXY, headers: { 'X-A': '1' }, credentials: 'include', paths: { liveness: '/l' } });
    expect(warn).not.toHaveBeenCalled();
  });

  it('sends the apiKey to baseUrl when both are set', async () => {
    const sdk = new BiometrySDK({ apiKey: 'k1', baseUrl: PROXY });
    mockOk({ data: { session_id: 's' }, meta: {} });
    await sdk.startSession();
    expect(fetch).toHaveBeenCalledWith(`${PROXY}/sessions`, expect.objectContaining({
      headers: { Authorization: 'Bearer k1' },
    }));
  });

  it('passes credentials through to fetch when set', async () => {
    const sdk = new BiometrySDK({ baseUrl: PROXY, credentials: 'include' });
    mockOk({ data: { session_id: 's' }, meta: {} });
    await sdk.startSession();
    expect(lastInit().credentials).toBe('include');
  });
});
