import { ConsentResponse, FaceMatchResponse, FaceEnrollmentResponse, VoiceEnrollmentResponse, DocAuthInfo, ApiResponse, FaceEnrollmentResult, ProcessVideoResponse } from "./types";

export class BiometrySDK {
  private apiKey: string;
  private static readonly BASE_URL: string = 'https://api.biometrysolutions.com'; //'https://dev-console.biometrysolutions.com';

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('API Key is required to initialize the SDK.');
    }

    this.apiKey = apiKey;
  }

  private async request<T> (path: string, method: string, body?: any, headers?: Record<string, string>): 
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

    // Extract response headers
    const responseHeaders: Record<string, string> = {};
    const requestId = response.headers.get("X-Request-Id");
    if (requestId) {
      responseHeaders["X-Request-Id"] = requestId;
    }
    
    const data = await response.json();

    return { 
      data: data as T, 
      headers: responseHeaders 
    };
  }

  /**
   * Starts a new Session for a user.
   * 
   * @returns {Promise<string>} A promise resolving to the session ID.
   * @throws {Error} - If the request fails.
   */
  async startSession(): Promise<string> {
    const response = await this.request<{ data: string, message: string }>(
      '/api-gateway/sessions/start',
      'POST'
    );
    return response.data;
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
   * @returns {Promise<ConsentResponse>} A promise resolving to the consent response.
   * @throws {Error} - If the user's full name is not provided or if the request fails.
   */
  async giveAuthorizationConsent(
    isConsentGiven: boolean,
    userFullName: string,
    props?: {
      sessionId?: string,
      deviceInfo?: object,
    }
  ): Promise<ApiResponse<ConsentResponse>>  {
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

    const response = await this.request<{ data: { is_consent_given: boolean; user_fullname: string } }>(
      '/api-consent/consent',
      'POST',
      body,
      headers
    );

    return {
      is_consent_given: response.data.is_consent_given,
      user_fullname: response.data.user_fullname,
    };
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
   * @returns {Promise<ConsentResponse>} A promise resolving to the consent response.
   * @throws {Error} - If the user's full name is not provided or if the request fails.
   */
  async giveStorageConsent(
    isStorageConsentGiven: boolean,
    userFullName: string,
    props?: {
      sessionId?: string,
      deviceInfo?: object,
    }
  ): Promise<ConsentResponse> {
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

    const response = await this.request<{ data: { is_consent_given: boolean; user_fullname: string } }>(
      '/api-consent/strg-consent',
      'POST',
      body,
      headers
    );

    return {
      is_consent_given: response.data.is_consent_given,
      user_fullname: response.data.user_fullname,
    };
    return response;
  }

  /**
   * Enrolls a user's voice for biometric authentication.
   * 
   * @param {File} audio - The audio file containing the user's voice.
   * @param {string} userFullName - The full name of the user being enrolled.
   * @param {string} uniqueId - A unique identifier for the enrolling process.
   * @param {string} phrase - The phrase spoken in the audio file.
   * @param {Object} [props] - Optional properties for the enrollment request.
   * @param {string} [props.sessionId] - Session ID to link this enrollment with a specific session group.
   * @param {object} [props.deviceInfo] - Device information object containing details about the user's device.
   *                                      This can include properties like operating system, browser, etc.
   * @returns {Promise<VoiceEnrollmentResponse>} - A promise resolving to the voice enrolling response.
   * @throws {Error} - If required parameters are missing or the request fails.
   */
  async enrollVoice(
    audio: File,
    userFullName: string,
    uniqueId: string,
    phrase: string,
    props?: {
      sessionId?: string,
      deviceInfo?: object,
    }
  ): Promise<ApiResponse<VoiceEnrollmentResponse>>  {
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

    if (props?.sessionId) {
      headers['X-Session-ID'] = props.sessionId;
    }

    if (props?.deviceInfo) {
      headers['X-Device-Info'] = JSON.stringify(props.deviceInfo);
    }

    if (props?.deviceInfo) {
      headers['X-Device-Info'] = JSON.stringify(props.deviceInfo);
    }

    const response = await this.request<VoiceEnrollmentResponse>(
      '/api-gateway/enroll/voice',
      'POST',
      formData,
      headers
    );
    return response;
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
   * @returns {Promise<FaceEnrollmentResponse>} - A promise resolving to the voice enrolling response.
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

    if (props?.deviceInfo) {
      headers['X-Device-Info'] = JSON.stringify(props.deviceInfo);
    }

    const response = await this.request<FaceEnrollmentResponse>(
      '/api-gateway/enroll/face',
      'POST',
      formData,
      headers
    );
    return response;
  }

  /**
   * Check the validity of a documents.
   * 
   * @param {File} document - Document image file.
   * @param {string} userFullName - The full name of the user being checked.
   * @param {Object} [props] - Optional properties for the enrollment request.
   * @param {string} [props.sessionId] - Session ID to link this enrollment with a specific session group.
   * @param {object} [props.deviceInfo] - Device information object containing details about the user's device.
   *                                      This can include properties like operating system, browser, etc.
   * @returns {Promise<DocAuthInfo>} - A promise resolving to the document authentication information.
   */
  async checkDocAuth(
    document: File,
    userFullName: string,
    props?: {
      sessionId?: string,
      deviceInfo?: object,
    }
  ): Promise<DocAuthInfo> {
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

    const response = await this.request<{ data: DocAuthInfo, message: string }>(
      '/api-gateway/check-doc-auth',
      'POST',
      formData,
      headers
    );

    return response.data;
  }

  /**
   * Check the validity of a documents.
   * 
   * @param {File} document - Document image file.
   * @param {string} userFullName - The full name of the user being checked.
   * @param {Object} [props] - Optional properties for the enrollment request.
   * @param {string} [props.sessionId] - Session ID to link this enrollment with a specific session group.
   * @param {object} [props.deviceInfo] - Device information object containing details about the user's device.
   *                                      This can include properties like operating system, browser, etc.
   * @returns {Promise<DocAuthInfo>} - A promise resolving to the document authentication information.
   */
  async checkDocAuth(
    document: File,
    userFullName: string,
    props?: {
      sessionId?: string,
      deviceInfo?: object,
    }
  ): Promise<DocAuthInfo> {
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

    const response = await this.request<{ data: DocAuthInfo, message: string }>(
      '/api-gateway/check-doc-auth',
      'POST',
      formData,
      headers
    );

    return response.data;
  }

  /**
   * Matches a user's face from video against a reference image.
   * 
   * @param {File} image - Reference image file that contains user's face.
   * @param {string} video - Video file that contains user's face.
   * @param {string} userFullName - Pass the full name of end-user to process Voice and Face recognition services.
   * @param {string} processVideoRequestId - ID from the response header of /process-video endpoint.
   * @param {boolean} usePrefilledVideo - Pass true to use the video from the process-video endpoint.
   * @param {Object} [props] - Optional properties for the enrollment request.
   * @param {string} [props.sessionId] - Session ID to link this enrollment with a specific session group.
   * @param {object} [props.deviceInfo] - Device information object containing details about the user's device.
   *                                      This can include properties like operating system, browser, etc.
   * @returns {Promise<FaceMatchResponse>} - A promise resolving to the voice enrolling response.
   * @throws {Error} - If required parameters are missing or the request fails.
   */
  async matchFaces(
    image: File,
    video?: File,
    userFullName?: string,
    processVideoRequestId?: string,
    usePrefilledVideo?: boolean,
    props?: {
      sessionId?: string,
      deviceInfo?: object,
    }
  ): Promise<ApiResponse<FaceMatchResponse>>  {
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

    if (props?.sessionId) {
      headers['X-Session-ID'] = props.sessionId;
    }

    if (props?.deviceInfo) {
      headers['X-Device-Info'] = JSON.stringify(props.deviceInfo);
    }

    if (props?.deviceInfo) {
      headers['X-Device-Info'] = JSON.stringify(props.deviceInfo);
    }

    const response = await this.request<FaceMatchResponse>(
      '/api-gateway/match-faces',
      'POST',
      formData,
      headers
    );
    return response;
  }

  /**
   * Process the video through Biometry services to check liveness and authorize user
   * 
   * @param {File} video - Video file that you want to process.
   * @param {string} phrase - Set of numbers that user needs to say out loud in the video.
   * @param {string} userFullName - Pass the full name of end-user to process Voice and Face recognition services.
   * @param {Object} [props] - Optional properties for the enrollment request.
   * @param {string} [props.sessionId] - Session ID to link this enrollment with a specific session group.
   * @param {object} [props.deviceInfo] - Device information object containing details about the user's device.
   *                                      This can include properties like operating system, browser, etc.
   * @returns 
   */
  async processVideo(
    video: File,
    phrase: string,
    userFullName?: string,
    props?: {
      sessionId?: string,
      deviceInfo?: object,
    }
  ): Promise<ApiResponse<ProcessVideoResponse>>  {
    if (!video) throw new Error('Video is required.');
    if (!phrase) throw new Error('Phrase is required.');

    const formData = new FormData();
    formData.append('phrase', phrase); 
    formData.append('video', video);

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

    const response = await this.request<any>(                                            
      '/api-gateway/process-video',
      'POST',
      formData,
      headers
    );
  
    return response;
  }
}