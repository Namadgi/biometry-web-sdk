import { BiometrySDK } from './sdk';
import { VoiceOnboardingResponse } from './types';

// Mock the fetch API globally
global.fetch = jest.fn();

describe('BiometrySDK', () => {
  const apiKey = 'test-api-key';
  const sdk = new BiometrySDK(apiKey);

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should throw an error if no API key is provided', () => {
    expect(() => new BiometrySDK('')).toThrow('API Key is required to initialize the SDK.');
  });

  // CONSENT
  it('should call fetch with correct headers and body when giving consent', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ is_consent_given: true, user_fullname: 'John Doe' }),
    });

    const result = await sdk.giveConsent(true, 'John Doe');

    expect(fetch).toHaveBeenCalledWith(
      'https://api.biometrysolutions.com/consent',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          is_consent_given: true,
          user_fullname: 'John Doe',
        }),
      })
    );

    expect(result).toEqual({ is_consent_given: true, user_fullname: 'John Doe', });
  });

  it('should throw an error if response is not ok', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'is_consent_given must be true' }),
    });

    await expect(sdk.giveConsent(true, 'John Doe')).rejects.toThrow('Error 400: undefined');
  });

  // VOICE ONBOARDING
  it('should throw an error if user fullname is missing', async () => {
    const audioFile = new File(['audio data'], 'audio.wav', { type: 'audio/wav' });
    await expect(sdk.onboardVoice(audioFile, '', 'uniqueId', 'phrase')).rejects.toThrowError('User fullname is required.');
  });

  it('should throw an error if unique ID is missing', async () => {
    const audioFile = new File(['audio data'], 'audio.wav', { type: 'audio/wav' });
    await expect(sdk.onboardVoice(audioFile, 'User Name', '', 'phrase')).rejects.toThrowError('Unique ID is required.');
  });

  it('should throw an error if phrase is missing', async () => {
    const audioFile = new File(['audio data'], 'audio.wav', { type: 'audio/wav' });
    await expect(sdk.onboardVoice(audioFile, 'User Name', 'uniqueId', '')).rejects.toThrowError('Phrase is required.');
  });

  it('should throw an error if audio file is missing', async () => {
    await expect(sdk.onboardVoice(null as unknown as File, 'User Name', 'uniqueId', 'phrase')).rejects.toThrowError('Audio file is required.');
  });

  it('should successfully onboard voice and return the response', async () => {
    const mockResponse: VoiceOnboardingResponse = {
      status: 'good',
    };

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const audioFile = new File(['audio data'], 'audio.wav', { type: 'audio/wav' });
    const userFullName = 'User Name';
    const uniqueId = 'uniqueId';
    const phrase = 'phrase';

    const formDataSpy = jest.spyOn(FormData.prototype, 'append');
    const result = await sdk.onboardVoice(audioFile, userFullName, uniqueId, phrase);

    expect(formDataSpy).toHaveBeenCalledWith('unique_id', uniqueId);
    expect(formDataSpy).toHaveBeenCalledWith('phrase', phrase);
    expect(formDataSpy).toHaveBeenCalledWith('voice', audioFile);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.biometrysolutions.com/api-gateway/onboard/voice',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'X-User-Fullname': userFullName,
        },
        body: expect.any(FormData)
      })
    );

    expect(result).toEqual(mockResponse);
  });

  // FACE ONBOARDING
  it('should throw an error if user fullname is missing', async () => {
    const imageFile = new File(['image data'], 'image.jpg', { type: 'image/jpeg' });
    await expect(sdk.onboardFace(imageFile, '')).rejects.toThrowError('User fullname is required.');
  });

  it('should throw an error if image file is missing', async () => {
    await expect(sdk.onboardFace(null as unknown as File, 'User Name')).rejects.toThrowError('Face image is required.');
  });

  it('should successfully onboard face and return the response', async () => {
    const mockResponse = {
      code: 200,
      description: 'Face onboarded successfully',
    };

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const imageFile = new File(['image data'], 'image.jpg', { type: 'image/jpeg' });
    const userFullName = 'User Name';

    const formDataSpy = jest.spyOn(FormData.prototype, 'append');
    const result = await sdk.onboardFace(imageFile, userFullName);

    expect(formDataSpy).toHaveBeenCalledWith('face', imageFile);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.biometrysolutions.com/api-gateway/onboard/face',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'X-User-Fullname': userFullName,
        },
        body: expect.any(FormData)
      })
    );

    expect(result).toEqual(mockResponse);
  });

  // FACE MATCH
  it('should throw an error if face image is missing', async () => {
    await expect(sdk.matchFaces(null as unknown as File, null as unknown as File)).rejects.toThrowError('Face image is required.');
  });

  it('should throw an error if video file is missing', async () => {
    const imageFile = new File(['image data'], 'image.jpg', { type: 'image/jpeg' });
    await expect(sdk.matchFaces(imageFile, null as unknown as File)).rejects.toThrowError('Video is required.');
  });

  it('should successfully match faces and return the response', async () => {
    const mockResponse = {
      code: 200,
      result: 1,
      description: 'Matched',
      anchor: {
        code: 200,
        description: 'Anchor face',
      },
      target: {
        code: 200,
        description: 'Target face',
      },
    };

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const imageFile = new File(['image data'], 'image.jpg', { type: 'image/jpeg' });
    const videoFile = new File(['video data'], 'video.mp4', { type: 'video/mp4' });

    const formDataSpy = jest.spyOn(FormData.prototype, 'append');
    const result = await sdk.matchFaces(imageFile, videoFile);

    expect(formDataSpy).toHaveBeenCalledWith('video', videoFile);
    expect(formDataSpy).toHaveBeenCalledWith('image', imageFile);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.biometrysolutions.com/api-gateway/match-faces',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
        body: expect.any(FormData)
      })
    );

    expect(result).toEqual(mockResponse);
  });

  it('should successfully match faces if processVideoRequestId is provided', async () => {
    const mockResponse = {
      code: 200,
      result: 1,
      description: 'Matched',
      anchor: {
        code: 200,
        description: 'Anchor face',
      },
      target: {
        code: 200,
        description: 'Target face',
      },
    };

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const imageFile = new File(['image data'], 'image.jpg', { type: 'image/jpeg' });

    const formDataSpy = jest.spyOn(FormData.prototype, 'append');
    const result = await sdk.matchFaces(imageFile, undefined, 'User Name', 'processVideoRequestId', true);

    expect(formDataSpy).toHaveBeenCalledWith('image', imageFile);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.biometrysolutions.com/api-gateway/match-faces',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'X-User-Fullname': 'User Name',
          'X-Request-Id': 'processVideoRequestId',
          'X-Use-Prefilled-Video': 'true',
        },
        body: expect.any(FormData)
      })
    );

    expect(result).toEqual(mockResponse);
  });

  // PROCESS VIDEO
  it('should throw an error if video file is missing', async () => {
    await expect(sdk.processVideo(null as unknown as File, 'phrase')).rejects.toThrowError('Video is required.');
  });

  it('should throw an error if phrase is missing', async () => {
    const videoFile = new File(['video data'], 'video.mp4', { type: 'video/mp4' });
    await expect(sdk.processVideo(videoFile, '')).rejects.toThrowError('Phrase is required.');
  });

  it('should successfully process video and return the response', async () => {
    const mockResponse = {
      data: {
        'Active Speaker Detection': {
          code: 0,
          description: 'Successful check',
          result: 90.00,
        },
        'Face Liveness Detection': {
          code: 0,
          description: 'Successful check',
          result: true,
        },
        'Face Recognition': {
          code: 0,
          description: 'Successful check',
        },
        'Visual Speech Recognition': {
          code: 0,
          description: 'Successful check',
          result: 'ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT',
        },
        'Voice Recognition': {
          status: 'good',
          id: '123',
          score: 0.99,
          imposter_prob: 0.01,
          log_odds: '1.0',
        },
      },
      result_conditions: {
        failed_conditions: [],
        failed_refer_conditions: [],
        status: 'pass',
      },
      message: 'video processed successfully',
    };

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const videoFile = new File(['video data'], 'video.mp4', { type: 'video/mp4' });
    const phrase = 'ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT';

    const formDataSpy = jest.spyOn(FormData.prototype, 'append');
    const result = await sdk.processVideo(videoFile, phrase);

    expect(formDataSpy).toHaveBeenCalledWith('video', videoFile);
    expect(formDataSpy).toHaveBeenCalledWith('phrase', phrase);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.biometrysolutions.com/api-gateway/process-video',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
        body: expect.any(FormData)
      })
    );

    expect(result).toEqual(mockResponse);
  });
});
