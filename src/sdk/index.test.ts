import { BiometrySDK, BiometryApiError } from '.';

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
