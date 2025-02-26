import { ConsentResponse, FaceMatchResponse, FaceEnrollmentResponse, VoiceEnrollmentResponse } from "./types";

export class BiometrySDK {
  private apiKey: string;
  private static readonly BASE_URL: string = 'https://api.biometrysolutions.com';

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('API Key is required to initialize the SDK.');
    }

    this.apiKey = apiKey;
  }

  private async request<T>(path: string, method: string, body?: any, headers?: Record<string, string>): Promise<T> {
    const defaultHeaders: HeadersInit = {
      Authorization: `Bearer ${this.apiKey}`,
    };

    const requestHeaders = { ...defaultHeaders, ...headers };

    if (body && !(body instanceof FormData)) {
      requestHeaders['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }

    const response = await fetch(`${BiometrySDK.BASE_URL}${path}`, {
      method,
      headers: requestHeaders,
      body,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData?.error || errorData?.message || 'Unknown error occurred';
  
      throw new Error(`Error ${response.status}: ${errorMessage}`);
    }

    return await response.json();
  }

  /**
   * Submits consent for a user.
   * 
   * @param {boolean} isConsentGiven - Indicates whether the user has given consent.
   * @param {string} userFullName - The full name of the user giving consent.
   * @returns {Promise<ConsentResponse>} A promise resolving to the consent response.
   * @throws {Error} - If the user's full name is not provided or if the request fails.
   */
  async giveConsent(
    isConsentGiven: boolean,
    userFullName: string
  ): Promise<ConsentResponse> {
    if (!userFullName) {
      throw new Error('User Full Name is required to give consent.');
    }

    const body = {
      is_consent_given: isConsentGiven,
      user_fullname: userFullName,
    };

    const response = await this.request<{ is_consent_given: boolean; user_fullname: string }>(
      '/api-consent/consent',
      'POST',
      body
    );

    return {
      is_consent_given: response.is_consent_given,
      user_fullname: response.user_fullname,
    };
  }

  /**
   * Enrolls a user's voice for biometric authentication.
   * 
   * @param {File} audio - The audio file containing the user's voice.
   * @param {string} userFullName - The full name of the user being enrolled.
   * @param {string} uniqueId - A unique identifier for the enrolling process.
   * @param {string} phrase - The phrase spoken in the audio file.
   * @param {string} [requestUserProvidedId] - An optional user-provided ID to link transactions within a unified group.
   * @returns {Promise<VoiceEnrollmentResponse>} - A promise resolving to the voice enrolling response.
   * @throws {Error} - If required parameters are missing or the request fails.
   */
  async enrollVoice(
    audio: File,
    userFullName: string,
    uniqueId: string,
    phrase: string,
    requestUserProvidedId?: string
  ): Promise<VoiceEnrollmentResponse> {
    if (!userFullName) throw new Error('User fullname is required.');
    if (!uniqueId) throw new Error('Unique ID is required.');
    if (!phrase) throw new Error('Phrase is required.');
    if (!audio) throw new Error('Audio file is required.');

    const formData = new FormData();
    formData.append('unique_id', uniqueId);
    formData.append('phrase', phrase);
    formData.append('voice', audio);

    const headers: Record<string, string> = {
      'X-User-Fullname': userFullName,
    };

    if (requestUserProvidedId) {
      headers['X-Request-User-Provided-ID'] = requestUserProvidedId;
    }

    return this.request<VoiceEnrollmentResponse>(
      '/api-gateway/enroll/voice',
      'POST',
      formData,
      headers
    );
  }

  /**
   * Enrolls a user's face for biometric authentication.
   * 
   * @param {File} face - Image file that contains user's face.
   * @param {string} userFullName - The full name of the user being enrolled.
   * @param {string} isDocument - Indicates whether the image is a document.
   * @param {string} [requestUserProvidedId] - An optional user-provided ID to link transactions within a unified group.
   * @returns {Promise<FaceEnrollmentResponse>} - A promise resolving to the voice enrolling response.
   * @throws {Error} - If required parameters are missing or the request fails.
   */
  async enrollFace(face: File, userFullName: string, isDocument?: boolean, requestUserProvidedId?: string): Promise<FaceEnrollmentResponse> {
    if (!userFullName) throw new Error('User fullname is required.');
    if (!face) throw new Error('Face image is required.');

    const formData = new FormData();
    formData.append('face', face);
    if (isDocument) {
      formData.append('is_document', 'true');
    }

    const headers: Record<string, string> = {
      'X-User-Fullname': userFullName,
    };

    if (requestUserProvidedId) {
      headers['X-Request-User-Provided-ID'] = requestUserProvidedId;
    }

    return this.request<FaceEnrollmentResponse>(
      '/api-gateway/enroll/face',
      'POST',
      formData,
      headers
    );
  }

  /**
   * Matches a user's face from video against a reference image.
   * 
   * @param {File} image - Reference image file that contains user's face.
   * @param {string} video - Video file that contains user's face.
   * @param {string} userFullName - Pass the full name of end-user to process Voice and Face recognition services.
   * @param {string} processVideoRequestId - ID from the response header of /process-video endpoint.
   * @param {boolean} usePrefilledVideo - Pass true to use the video from the process-video endpoint.
   * @param {string} [requestUserProvidedId] - An optional user-provided ID to link transactions within a unified group.
   * @returns {Promise<FaceMatchResponse>} - A promise resolving to the voice enrolling response.
   * @throws {Error} - If required parameters are missing or the request fails.
   */
  async matchFaces(
    image: File,
    video?: File,
    userFullName?: string,
    processVideoRequestId?: string,
    usePrefilledVideo?: boolean,
    requestUserProvidedId?: string
  ): Promise<FaceMatchResponse> {
    if (!image) throw new Error('Face image is required.');
    if ((!processVideoRequestId && !usePrefilledVideo) && !video) throw new Error('Video is required.');

    const formData = new FormData();
    if (video) {
      formData.append('video', video);
    }
    formData.append('image', image);

    const headers: Record<string, string> = {};

    if (userFullName) {
      headers['X-User-Fullname'] = userFullName;
    }

    if (processVideoRequestId) {
      headers['X-Request-Id'] = processVideoRequestId;
    }

    if (processVideoRequestId && usePrefilledVideo) {
      headers['X-Use-Prefilled-Video'] = 'true';
    }

    if (requestUserProvidedId) {
      headers['X-Request-User-Provided-ID'] = requestUserProvidedId;
    }

    return this.request<FaceMatchResponse>(
      '/api-gateway/match-faces',
      'POST',
      formData,
      headers
    );
  }

  /**
   * Process the video through Biometry services to check liveness and authorize user
   * 
   * @param {File} video - Video file that you want to process.
   * @param {string} phrase - Set of numbers that user needs to say out loud in the video.
   * @param {string} userFullName - Pass the full name of end-user to process Voice and Face recognition services.
   * @param {string} requestUserProvidedId - An optional user-provided ID to link transactions within a unified group.
   * @param {object} deviceInfo - Pass the device information in JSON format to include in transaction.
   * @returns 
   */
  async processVideo(
    video: File,
    phrase: string,
    userFullName?: string,
    requestUserProvidedId?: string,
    deviceInfo?: object
  ): Promise<any> {
    if (!video) throw new Error('Video is required.');
    if (!phrase) throw new Error('Phrase is required.');

    const formData = new FormData();
    formData.append('phrase', phrase);
    formData.append('video', video);

    const headers: Record<string, string> = {};

    if (userFullName) {
      headers['X-User-Fullname'] = userFullName;
    }

    if (requestUserProvidedId) {
      headers['X-Request-User-Provided-ID'] = requestUserProvidedId;
    }

    if (deviceInfo) {
      headers['X-Device-Info'] = JSON.stringify(deviceInfo);
    }

    return this.request<any>(
      '/api-gateway/process-video',
      'POST',
      formData,
      headers
    );
  }
}