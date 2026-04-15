import { ApiResponse } from "../types/internal";
import { DocAuthResponse } from "../types/biometry/doc-auth";
import { ConsentResponse } from "../types/biometry/consent";
import { FaceEnrollmentResponse, VoiceEnrollmentResponse } from "../types/biometry/enrollment";
import { FaceMatchResponse } from "../types/biometry/face-match";
import { ProcessVideoResponse } from "../types/biometry/process-video";
import { SessionResponse } from "../types/biometry/session";

export class BiometrySDK {
  private apiKey: string;
  private static readonly BASE_URL: string = 'https://api.biometrysolutions.com'; //'https://dev-console.biometrysolutions.com';

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('API Key is required to initialize the SDK.');
    }

    this.apiKey = apiKey;
  }

  private async request<T>(path: string, method: string, body?: any, headers?: Record<string, string>):
    Promise<ApiResponse<T>> {
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

    // 🔹 Extract ALL response headers
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const responseBody = await response.json();

    return {
      body: responseBody as T,
      headers: responseHeaders
    };
  }

  /**
   * Starts a new Session for a user.
   *
   * @param {Object} [props] - Optional properties.
   * @param {boolean} [props.warmup] - If true, triggers ML services warmup in the background.
   * @returns {Promise<ApiResponse<SessionResponse>>} A promise resolving to the session ID.
   * @throws {Error} - If the request fails.
   */
  async startSession(props?: { warmup?: boolean }): Promise<ApiResponse<SessionResponse>> {
    const query = props?.warmup ? '?warmup=true' : '';
    return await this.request<SessionResponse>(
      `/api-gateway/sessions/start${query}`,
      'POST'
    );
  }

  /**
   * Ends an existing session.
   *
   * @param {string} sessionId - The ID of the session to end.
   * @param {Object} [props] - Optional properties.
   * @param {string} [props.phoneNumber] - Phone number for SIM-swap fraud check via CAMARA API.
   * @returns {Promise<ApiResponse<{ message: string }>>} A promise resolving to the result message.
   * @throws {Error} - If the request fails.
   */
  async endSession(sessionId: string, props?: { phoneNumber?: string }): Promise<ApiResponse<{ message: string }>> {
    if (!sessionId) throw new Error('Session ID is required.');

    const body: Record<string, string> = {};
    if (props?.phoneNumber) {
      body['phone_number'] = props.phoneNumber;
    }

    return await this.request<{ message: string }>(
      `/api-gateway/sessions/end/${sessionId}`,
      'POST',
      body
    );
  }

  /**
   * Submits Authorization consent for a user.
   * Authorization Consent is required to use the services like Face and Voice recognition.
   * 
   * @param {boolean} isConsentGiven - Indicates whether the user has given consent.
   * @param {string} userFullName - The full name of the user giving consent.
   * @param {Object} [props] - Optional properties for the consent request.
   * @param {string} [props.sessionId] - Session ID to link this consent with a specific session group.
   * @param {object} [props.deviceInfo] - Device information object containing details about the user's device.
   *                                      This can include properties like operating system, browser, etc.
   * @returns {Promise<ApiResponse<ConsentResponse>>} A promise resolving to the consent response.
   * @throws {Error} - If the user's full name is not provided or if the request fails.
   */
  async giveAuthorizationConsent(
    isConsentGiven: boolean,
    userFullName: string,
    props?: {
      sessionId?: string,
      deviceInfo?: object,
    }
  ): Promise<ApiResponse<ConsentResponse>> {
    if (!userFullName) {
      throw new Error('User Full Name is required to give consent.');
    }

    const body = {
      is_consent_given: isConsentGiven,
      user_fullname: userFullName,
    };

    const headers: Record<string, string> = {};

    if (props?.sessionId) {
      headers['X-Session-ID'] = props.sessionId;
    }

    if (props?.deviceInfo) {
      headers['X-Device-Info'] = JSON.stringify(props.deviceInfo);
    }

    return await this.request<ConsentResponse>(
      '/api-consent/consent',
      'POST',
      body,
      headers
    );
  }

  /**
   * Submits Storage consent for a user.
   * Storage consent is granted by users, allowing us to store their biometric data for future verification.
   * 
   * @param {boolean} isStorageConsentGiven - Indicates whether the user has given storage consent.
   * @param {string} userFullName - The full name of the user giving storage consent.
   * @param {Object} [props] - Optional properties for the consent request.
   * @param {string} [props.sessionId] - Session ID to link this consent with a specific session group.
   * @param {object} [props.deviceInfo] - Device information object containing details about the user's device.
   *                                      This can include properties like operating system, browser, etc.
   * @returns {Promise<ApiResponse<ConsentResponse>>} A promise resolving to the consent response.
   * @throws {Error} - If the user's full name is not provided or if the request fails.
   */
  async giveStorageConsent(
    isStorageConsentGiven: boolean,
    userFullName: string,
    props?: {
      sessionId?: string,
      deviceInfo?: object,
    }
  ): Promise<ApiResponse<ConsentResponse>> {
    if (!userFullName) {
      throw new Error('User Full Name is required to give storage consent.');
    }

    const body = {
      is_consent_given: isStorageConsentGiven,
      user_fullname: userFullName,
    };

    const headers: Record<string, string> = {};

    if (props?.sessionId) {
      headers['X-Session-ID'] = props.sessionId;
    }

    if (props?.deviceInfo) {
      headers['X-Device-Info'] = JSON.stringify(props.deviceInfo);
    }

    return await this.request<ConsentResponse>(
      '/api-consent/strg-consent',
      'POST',
      body,
      headers
    );
  }

  /**
   * Enrolls a user's voice for biometric authentication.
   * The user identity is derived from the userFullName parameter (sent as X-User-Fullname header).
   *
   * @param {File} audio - The audio file containing the user's voice.
   * @param {string} userFullName - The full name of the user being enrolled.
   * @param {string} phrase - The phrase spoken in the audio file.
   * @param {Object} [props] - Optional properties for the enrollment request.
   * @param {string} [props.sessionId] - Session ID to link this enrollment with a specific session group.
   * @param {object} [props.deviceInfo] - Device information object containing details about the user's device.
   *                                      This can include properties like operating system, browser, etc.
   * @returns {Promise<ApiResponse<VoiceEnrollmentResponse>>} - A promise resolving to the voice enrolling response.
   * @throws {Error} - If required parameters are missing or the request fails.
   */
  async enrollVoice(
    audio: File,
    userFullName: string,
    phrase: string,
    props?: {
      sessionId?: string,
      deviceInfo?: object,
    }
  ): Promise<ApiResponse<VoiceEnrollmentResponse>> {
    if (!userFullName) throw new Error('User fullname is required.');
    if (!phrase) throw new Error('Phrase is required.');
    if (!audio) throw new Error('Audio file is required.');

    const formData = new FormData();
    formData.append('phrase', phrase);
    formData.append('voice', audio);

    const headers: Record<string, string> = {
      'X-User-Fullname': userFullName,
    };

    if (props?.sessionId) {
      headers['X-Session-ID'] = props.sessionId;
    }

    if (props?.deviceInfo) {
      headers['X-Device-Info'] = JSON.stringify(props.deviceInfo);
    }

    return await this.request<VoiceEnrollmentResponse>(
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
   * @param {Object} [props] - Optional properties for the enrollment request.
   * @param {string} [props.sessionId] - Session ID to link this enrollment with a specific session group.
   * @param {object} [props.deviceInfo] - Device information object containing details about the user's device.
   *                                      This can include properties like operating system, browser, etc.
   * @returns {Promise<ApiResponse<FaceEnrollmentResponse>>} - A promise resolving to the voice enrolling response.
   * @throws {Error} - If required parameters are missing or the request fails.
   */
  async enrollFace(face: File, userFullName: string, isDocument?: boolean, props?: {
    sessionId?: string,
    deviceInfo?: object,
  }):
    Promise<ApiResponse<FaceEnrollmentResponse>> {
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

    if (props?.sessionId) {
      headers['X-Session-ID'] = props.sessionId;
    }

    if (props?.deviceInfo) {
      headers['X-Device-Info'] = JSON.stringify(props.deviceInfo);
    }

    return await this.request<FaceEnrollmentResponse>(
      '/api-gateway/enroll/face',
      'POST',
      formData,
      headers
    );
  }

  /**
   * Check the validity of a document.
   *
   * @param {File} document - Document image file (jpg/jpeg/png).
   * @param {string} userFullName - The full name of the user being checked.
   * @param {Object} [props] - Optional properties for the request.
   * @param {string} [props.sessionId] - Session ID to link this check with a specific session group.
   * @param {object} [props.deviceInfo] - Device information object containing details about the user's device.
   * @param {boolean} [props.inHouseCheck] - If false, uses external IDScan flow. Defaults to true (in-house GPT+ML flow).
   * @param {boolean} [props.mrzValidation] - If true, enables MRZ validation in the in-house flow.
   * @returns {Promise<ApiResponse<DocAuthResponse>>} - A promise resolving to the document authentication response.
   */
  async checkDocAuth(
    document: File,
    userFullName: string,
    props?: {
      sessionId?: string,
      deviceInfo?: object,
      inHouseCheck?: boolean,
      mrzValidation?: boolean,
    }
  ): Promise<ApiResponse<DocAuthResponse>> {
    if (!document) throw new Error('Document image is required.');
    if (!userFullName) throw new Error('User fullname is required.');

    const formData = new FormData();
    formData.append('document', document);

    const headers: Record<string, string> = {
      'X-User-Fullname': userFullName,
    };

    if (props?.sessionId) {
      headers['X-Session-ID'] = props.sessionId;
    }

    if (props?.deviceInfo) {
      headers['X-Device-Info'] = JSON.stringify(props.deviceInfo);
    }

    if (props?.inHouseCheck === false) {
      headers['X-Inhouse-Docauth'] = "false";
    }

    if (props?.mrzValidation) {
      headers['X-Inhouse-MRZ'] = "true";
    }

    return await this.request<DocAuthResponse>(
      '/api-gateway/docauth/check',
      'POST',
      formData,
      headers
    );
  }

  /**
   * Matches a user's face from video against a reference image.
   *
   * @param {File} image - Reference image file that contains user's face.
   * @param {File} [video] - Video file that contains user's face. Required unless usePrefilledVideo is true.
   * @param {string} [userFullName] - Full name of the end-user (used for session validation).
   * @param {boolean} [usePrefilledVideo] - If true, reuses the video captured in the process-video step of the
   *                                        same session. Requires props.sessionId.
   * @param {Object} [props] - Optional properties for the request.
   * @param {string} [props.sessionId] - Session ID. Required when usePrefilledVideo is true.
   * @param {object} [props.deviceInfo] - Device information object containing details about the user's device.
   * @returns {Promise<ApiResponse<FaceMatchResponse>>} - A promise resolving to the face match response.
   * @throws {Error} - If required parameters are missing or the request fails.
   */
  async matchFaces(
    image: File,
    video?: File,
    userFullName?: string,
    usePrefilledVideo?: boolean,
    props?: {
      sessionId?: string,
      deviceInfo?: object,
    }
  ): Promise<ApiResponse<FaceMatchResponse>> {
    if (!image) throw new Error('Face image is required.');
    if ((!usePrefilledVideo) && !video) throw new Error('Video is required.');
    if (usePrefilledVideo && !props?.sessionId) throw new Error('Session ID is required to use a video from the process-video endpoint.');

    const formData = new FormData();
    if (video) {
      formData.append('video', video);
    }
    formData.append('image', image);

    const headers: Record<string, string> = {};

    if (userFullName) {
      headers['X-User-Fullname'] = userFullName;
    }

    if (usePrefilledVideo) {
      headers['X-Use-Prefilled-Video'] = 'true';
    }

    if (props?.sessionId) {
      headers['X-Session-ID'] = props.sessionId;
    }

    if (props?.deviceInfo) {
      headers['X-Device-Info'] = JSON.stringify(props.deviceInfo);
    }

    return await this.request<FaceMatchResponse>(
      '/api-gateway/match-faces',
      'POST',
      formData,
      headers
    );
  }

  /**
   * Process the video through Biometry services to check liveness and authorize user.
   *
   * @param {File} video - Video file that you want to process.
   * @param {string} phrase - Set of numbers that user needs to say out loud in the video.
   * @param {string} [userFullName] - Full name of the end-user. Required for Voice and Face recognition services.
   * @param {Object} [props] - Optional properties for the request.
   * @param {string} [props.sessionId] - Session ID to link this request with a specific session group.
   * @param {object} [props.deviceInfo] - Device information object containing details about the user's device.
   * @param {string} [props.vocabulary] - Vocabulary hint for speech recognition (e.g. 'en_digits'). Defaults to en_digits on the server.
   * @param {string} [props.trigger] - Action trigger that initiated this request (e.g. 'authentication', 'registration', 'confirmation').
   * @returns {Promise<ApiResponse<ProcessVideoResponse>>} - A promise resolving to the process video response.
   */
  async processVideo(
    video: File,
    phrase: string,
    userFullName?: string,
    props?: {
      sessionId?: string,
      deviceInfo?: object,
      vocabulary?: string,
      trigger?: string,
    }
  ): Promise<ApiResponse<ProcessVideoResponse>> {
    if (!video) throw new Error('Video is required.');
    if (!phrase) throw new Error('Phrase is required.');

    const formData = new FormData();
    formData.append('phrase', phrase);
    formData.append('video', video);

    if (props?.vocabulary) {
      formData.append('vocabulary', props.vocabulary);
    }

    if (props?.trigger) {
      formData.append('trigger', props.trigger);
    }

    const headers: Record<string, string> = {};

    if (userFullName) {
      headers['X-User-Fullname'] = userFullName;
    }

    if (props?.sessionId) {
      headers['X-Session-ID'] = props.sessionId;
    }

    if (props?.deviceInfo) {
      headers['X-Device-Info'] = JSON.stringify(props.deviceInfo);
    }

    return await this.request<ProcessVideoResponse>(
      '/api-gateway/process-video',
      'POST',
      formData,
      headers
    );
  }
}