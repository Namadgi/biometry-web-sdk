import { ApiResponse, ResponseMeta, SuccessEnvelope } from "../types/internal";
import { DocAuthInfo } from "../types/biometry/doc-auth";
import { ConsentResponse } from "../types/biometry/consent";
import { EnrollmentData } from "../types/biometry/enrollment";
import { FaceMatchData } from "../types/biometry/face-match";
import {
  FaceVerifyData,
  LivenessData,
  VerificationService,
  VoiceVerifyData,
} from "../types/biometry/process-video";
import { SessionStartData } from "../types/biometry/session";

/**
 * Error thrown when the Biometry API returns a non-2xx response. Exposes the
 * HTTP status, the API v2 error `code`, and the response `meta` (including
 * `request_id`) when available.
 */
export class BiometryApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly meta?: ResponseMeta;

  constructor(status: number, code: string | undefined, message: string, meta?: ResponseMeta) {
    super(`Error ${status}${code ? ` [${code}]` : ''}: ${message}`);
    this.name = 'BiometryApiError';
    this.status = status;
    this.code = code;
    this.meta = meta;
  }
}

/**
 * Fields of the API v2 multipart `request` part. Serialized to JSON and attached
 * as the `request` form field; the gateway decodes it and derives the internal
 * identity/session/service headers from it.
 */
interface V2RequestPart {
  user_id?: string;
  session_id?: string;
  phrase?: string;
  vocabulary?: string;
  trigger?: string;
  use_session_video?: boolean;
  provider?: 'inhouse' | 'idscan';
  mrz_provider?: 'inhouse' | 'idscan';
  is_document?: boolean;
  services?: { include?: string[]; exclude?: string[] };
}

/**
 * Copies `source` into `target`, replacing any header of the same name
 * regardless of case, so `authorization` overrides `Authorization` instead of
 * both being sent (which `fetch` would join into one comma-separated value).
 */
function setHeaders(target: Record<string, string>, source?: Record<string, string>): void {
  if (!source) return;
  for (const [name, value] of Object.entries(source)) {
    const lower = name.toLowerCase();
    for (const existing of Object.keys(target)) {
      if (existing.toLowerCase() === lower) delete target[existing];
    }
    target[name] = value;
  }
}

/** Returns `baseUrl` without trailing slashes, or throws if it is not an absolute http(s) URL. */
function normalizeBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`baseUrl must be an absolute http or https URL, got "${baseUrl}".`);
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || /[?#]/.test(baseUrl)) {
    throw new Error(`baseUrl must be an absolute http or https URL with no "?" or "#", got "${baseUrl}".`);
  }
  return baseUrl.replace(/\/+$/, '');
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/** Drops undefined/null/empty-string entries so the JSON `request` part stays lean. */
function compactRequest(request: V2RequestPart): V2RequestPart {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(request)) {
    if (!isEmpty(value)) out[key] = value;
  }
  return out as V2RequestPart;
}

/** Extra headers sent on every request: a fixed object, or a function called per request. */
export type BiometryHeaders =
  | Record<string, string>
  | (() => Record<string, string> | Promise<Record<string, string>>);

/**
 * Options for {@link BiometrySDK}. Pass `baseUrl` to send every request to your
 * own backend proxy instead of the Biometry API, so the project API key never
 * ships in the browser bundle.
 */
export interface BiometrySDKOptions {
  /**
   * Biometry project API key, sent as `Authorization: Bearer <apiKey>`.
   * Required when `baseUrl` is not set. Leave it out in proxy mode: your
   * proxy adds the key server-side.
   */
  apiKey?: string;
  /**
   * Absolute http(s) origin (plus optional path prefix) that replaces
   * `https://api.biometrysolutions.com`. Request paths are kept as is, so
   * `baseUrl: 'https://app.example.com/biometry'` sends session starts to
   * `https://app.example.com/biometry/api-gateway/v2/sessions`.
   */
  baseUrl?: string;
  /**
   * Extra headers sent on every request, for example your app's own session
   * token for the proxy. Applied after the `Authorization` header from
   * `apiKey`, so a header with the same name here (compared
   * case-insensitively) replaces it. Only used with `baseUrl`; without it they
   * are ignored with a console warning.
   */
  headers?: BiometryHeaders;
  /**
   * Passed to `fetch` as `credentials`. Set to `'include'` when the proxy is on
   * another origin and authenticates with cookies. Not set by default. Only
   * used with `baseUrl`; without it, it is ignored with a console warning.
   */
  credentials?: RequestCredentials;
}

export class BiometrySDK {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly extraHeaders?: BiometryHeaders;
  private readonly credentials?: RequestCredentials;
  private static readonly BASE_URL: string = 'https://api.biometrysolutions.com';
  /** API v2 gateway prefix. */
  private static readonly GATEWAY_V2: string = '/api-gateway/v2';

  /**
   * @param apiKeyOrOptions - Your project API key (direct mode), or
   *   {@link BiometrySDKOptions} (for proxy mode, `{ baseUrl }` with no `apiKey`).
   * @throws {Error} If neither an API key nor a `baseUrl` is given, or if
   *   `baseUrl` is not an absolute http(s) URL with no `?` or `#`.
   */
  constructor(apiKeyOrOptions: string | BiometrySDKOptions) {
    if (typeof apiKeyOrOptions === 'string' || apiKeyOrOptions == null) {
      if (!apiKeyOrOptions) {
        throw new Error('API Key is required to initialize the SDK.');
      }
    }
    const options: BiometrySDKOptions = typeof apiKeyOrOptions === 'string'
      ? { apiKey: apiKeyOrOptions }
      : apiKeyOrOptions;

    if (!options.apiKey && !options.baseUrl) {
      throw new Error('apiKey or baseUrl is required to initialize the SDK.');
    }

    this.apiKey = options.apiKey || undefined;
    this.baseUrl = options.baseUrl
      ? normalizeBaseUrl(options.baseUrl)
      : BiometrySDK.BASE_URL;
    if (options.baseUrl) {
      this.extraHeaders = options.headers;
      this.credentials = options.credentials;
    } else if (options.headers || options.credentials) {
      // Direct mode talks to the Biometry API itself, which only needs the API
      // key. Custom headers and credentials are meant for your own proxy.
      console.warn('BiometrySDK: `headers` and `credentials` only apply with `baseUrl` (proxy mode); they are ignored.');
    }
  }

  private async request<T>(path: string, method: string, body?: any, headers?: Record<string, string>):
    Promise<ApiResponse<T>> {
    const defaultHeaders: Record<string, string> = {};
    if (this.apiKey) {
      defaultHeaders.Authorization = `Bearer ${this.apiKey}`;
    }

    const extra = typeof this.extraHeaders === 'function'
      ? await this.extraHeaders()
      : this.extraHeaders;

    const requestHeaders: Record<string, string> = { ...defaultHeaders };
    setHeaders(requestHeaders, extra);
    setHeaders(requestHeaders, headers);

    if (body && !(body instanceof FormData)) {
      setHeaders(requestHeaders, { 'Content-Type': 'application/json' });
      body = JSON.stringify(body);
    }
    const init: RequestInit = {
      method,
      headers: requestHeaders,
      body,
    };
    if (this.credentials) {
      init.credentials = this.credentials;
    }
    const response = await fetch(`${this.baseUrl}${path}`, init);

    if (!response.ok) {
      throw await BiometrySDK.toApiError(response);
    }

    // Extract ALL response headers.
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
   * Parses an error response into a {@link BiometryApiError}. Handles both the
   * API v2 error envelope (`{ error: { code, message }, meta }`) and the legacy
   * consent-service shape (`{ error: "message" }`).
   */
  private static async toApiError(response: Response): Promise<BiometryApiError> {
    const errBody = await response.json().catch(() => ({} as any));

    let code: string | undefined;
    let message: string | undefined;

    const error = errBody?.error;
    if (typeof error === 'string') {
      message = error;
    } else if (error && typeof error === 'object') {
      // The backend is trusted to send a string code, but a nested object or
      // number would otherwise reach BiometryApiError.code untyped and render
      // as "[object Object]" inside the message.
      code = typeof error.code === 'string' ? error.code : undefined;
      message = typeof error.message === 'string'
        ? error.message
        : error.message != null ? JSON.stringify(error.message) : undefined;
    }

    if (!message) message = typeof errBody?.message === 'string' ? errBody.message : undefined;
    if (!message) message = 'Unknown error occurred';

    return new BiometryApiError(response.status, code, message, errBody?.meta);
  }

  /**
   * Builds a multipart body with the JSON `request` part plus binary file parts.
   *
   * @param request - Fields for the JSON `request` part (empty values are dropped).
   * @param files - Named file parts; entries with an undefined file are skipped.
   */
  private static buildMultipart(request: V2RequestPart, files: Record<string, File | undefined>): FormData {
    const formData = new FormData();
    formData.append('request', JSON.stringify(compactRequest(request)));
    for (const [name, file] of Object.entries(files)) {
      if (file) formData.append(name, file);
    }
    return formData;
  }

  /**
   * Starts a new Session.
   *
   * @param {Object} [props] - Optional properties.
   * @param {boolean} [props.warmup] - If true, triggers ML services warmup in the background.
   * @returns {Promise<ApiResponse<SuccessEnvelope<SessionStartData>>>} A promise resolving to the session envelope.
   * @throws {BiometryApiError} - If the request fails.
   */
  async startSession(props?: { warmup?: boolean }): Promise<ApiResponse<SuccessEnvelope<SessionStartData>>> {
    const query = props?.warmup ? '?warmup=true' : '';
    return await this.request<SuccessEnvelope<SessionStartData>>(
      `${BiometrySDK.GATEWAY_V2}/sessions${query}`,
      'POST'
    );
  }

  /**
   * Ends an existing session.
   *
   * @param {string} sessionId - The ID of the session to end.
   * @param {Object} [props] - Optional properties.
   * @param {string} [props.phoneNumber] - Phone number for SIM-swap fraud check via CAMARA API.
   * @returns {Promise<ApiResponse<SuccessEnvelope>>} A promise resolving to the result envelope.
   * @throws {BiometryApiError} - If the request fails.
   */
  async endSession(sessionId: string, props?: { phoneNumber?: string }): Promise<ApiResponse<SuccessEnvelope>> {
    if (!sessionId) throw new Error('Session ID is required.');

    const body = props?.phoneNumber ? { phone_number: props.phoneNumber } : undefined;

    return await this.request<SuccessEnvelope>(
      `${BiometrySDK.GATEWAY_V2}/sessions/${encodeURIComponent(sessionId)}/end`,
      'POST',
      body
    );
  }

  /**
   * Submits Authorization consent for a user.
   * Authorization Consent is required to use the services like Face and Voice recognition.
   *
   * Note: consent is served by the dedicated consent service (`/api-consent`), not
   * the API gateway, so this call is unaffected by the gateway v2 migration.
   *
   * @param {boolean} isConsentGiven - Indicates whether the user has given consent.
   * @param {string} userFullName - The full name of the user giving consent.
   * @param {Object} [props] - Optional properties for the consent request.
   * @param {string} [props.sessionId] - Session ID to link this consent with a specific session group.
   * @param {object} [props.deviceInfo] - Device information object.
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
   * Note: consent is served by the dedicated consent service (`/api-consent`), not
   * the API gateway, so this call is unaffected by the gateway v2 migration.
   *
   * @param {boolean} isStorageConsentGiven - Indicates whether the user has given storage consent.
   * @param {string} userFullName - The full name of the user giving storage consent.
   * @param {Object} [props] - Optional properties for the consent request.
   * @param {string} [props.sessionId] - Session ID to link this consent with a specific session group.
   * @param {object} [props.deviceInfo] - Device information object.
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
   * Enrolls a user's voice for voice recognition.
   *
   * @param {File} audio - The audio file containing the user's voice.
   * @param {string} userId - Opaque, customer-provided identity key for the user.
   * @param {string} phrase - The phrase spoken in the audio file.
   * @param {Object} [props] - Optional properties for the enrollment request.
   * @param {string} [props.vocabulary] - Vocabulary constraint for speech recognition (e.g. 'en_digits').
   * @returns {Promise<ApiResponse<SuccessEnvelope<EnrollmentData>>>} - A promise resolving to the enrollment envelope.
   * @throws {Error|BiometryApiError} - If required parameters are missing or the request fails.
   */
  async enrollVoice(
    audio: File,
    userId: string,
    phrase: string,
    props?: {
      vocabulary?: string,
    }
  ): Promise<ApiResponse<SuccessEnvelope<EnrollmentData>>> {
    if (!userId) throw new Error('User ID is required.');
    if (!phrase) throw new Error('Phrase is required.');
    if (!audio) throw new Error('Audio file is required.');

    const formData = BiometrySDK.buildMultipart(
      { user_id: userId, phrase, vocabulary: props?.vocabulary },
      { voice: audio }
    );

    return await this.request<SuccessEnvelope<EnrollmentData>>(
      `${BiometrySDK.GATEWAY_V2}/enrollments/voice`,
      'POST',
      formData
    );
  }

  /**
   * Enrolls a user's face for face recognition.
   *
   * @param {File} face - Image file that contains the user's face.
   * @param {string} userId - Opaque, customer-provided identity key for the user.
   * @param {Object} [props] - Optional properties for the enrollment request.
   * @param {boolean} [props.isDocument] - Indicates whether the image is a document photo.
   * @returns {Promise<ApiResponse<SuccessEnvelope<EnrollmentData>>>} - A promise resolving to the enrollment envelope.
   * @throws {Error|BiometryApiError} - If required parameters are missing or the request fails.
   */
  async enrollFace(
    face: File,
    userId: string,
    props?: {
      isDocument?: boolean,
    }
  ): Promise<ApiResponse<SuccessEnvelope<EnrollmentData>>> {
    if (!userId) throw new Error('User ID is required.');
    if (!face) throw new Error('Face image is required.');

    const formData = BiometrySDK.buildMultipart(
      { user_id: userId, is_document: props?.isDocument },
      { face }
    );

    return await this.request<SuccessEnvelope<EnrollmentData>>(
      `${BiometrySDK.GATEWAY_V2}/enrollments/face`,
      'POST',
      formData
    );
  }

  /**
   * Checks the authenticity of an identity document.
   *
   * @param {File} document - Document image file (jpg/jpeg/png).
   * @param {Object} [props] - Optional properties for the request.
   * @param {string} [props.sessionId] - Session ID to link this check with a specific session group.
   * @param {'inhouse'|'idscan'} [props.provider] - Document authenticity provider; defaults to the project config.
   * @param {'inhouse'|'idscan'} [props.mrzProvider] - MRZ extraction provider; defaults to the project config.
   * @returns {Promise<ApiResponse<SuccessEnvelope<DocAuthInfo>>>} - A promise resolving to the document auth envelope.
   * @throws {Error|BiometryApiError} - If required parameters are missing or the request fails.
   */
  async checkDocAuth(
    document: File,
    props?: {
      sessionId?: string,
      provider?: 'inhouse' | 'idscan',
      mrzProvider?: 'inhouse' | 'idscan',
    }
  ): Promise<ApiResponse<SuccessEnvelope<DocAuthInfo>>> {
    if (!document) throw new Error('Document image is required.');

    const formData = BiometrySDK.buildMultipart(
      {
        session_id: props?.sessionId,
        provider: props?.provider,
        mrz_provider: props?.mrzProvider,
      },
      { document }
    );

    return await this.request<SuccessEnvelope<DocAuthInfo>>(
      `${BiometrySDK.GATEWAY_V2}/documents/check`,
      'POST',
      formData
    );
  }

  /**
   * Matches a user's live image/video against a client-provided reference image.
   *
   * @param {File} referenceImage - Reference portrait image to match against.
   * @param {string} userId - Opaque, customer-provided identity key for the user.
   * @param {Object} [props] - Optional properties for the request.
   * @param {File} [props.video] - Captured live video/image. Required unless useSessionVideo is true.
   * @param {boolean} [props.useSessionVideo] - If true, reuses the video captured earlier in the same session.
   *                                            Requires props.sessionId.
   * @param {string} [props.sessionId] - Session ID. Required when useSessionVideo is true.
   * @returns {Promise<ApiResponse<SuccessEnvelope<FaceMatchData>>>} - A promise resolving to the face match envelope.
   * @throws {Error|BiometryApiError} - If required parameters are missing or the request fails.
   */
  async matchFaces(
    referenceImage: File,
    userId: string,
    props?: {
      video?: File,
      useSessionVideo?: boolean,
      sessionId?: string,
    }
  ): Promise<ApiResponse<SuccessEnvelope<FaceMatchData>>> {
    if (!referenceImage) throw new Error('Reference image is required.');
    if (!userId) throw new Error('User ID is required.');
    if (!props?.useSessionVideo && !props?.video) throw new Error('Video is required.');
    if (props?.useSessionVideo && !props?.sessionId) throw new Error('Session ID is required to reuse the session video.');

    const formData = BiometrySDK.buildMultipart(
      {
        user_id: userId,
        session_id: props?.sessionId,
        use_session_video: props?.useSessionVideo,
      },
      { reference_image: referenceImage, video: props?.video }
    );

    return await this.request<SuccessEnvelope<FaceMatchData>>(
      `${BiometrySDK.GATEWAY_V2}/face-match`,
      'POST',
      formData
    );
  }

  /**
   * Checks liveness (face liveness, active speaker detection, visual speech recognition)
   * on a captured video. Replaces part of the v1 `processVideo` flow.
   *
   * @param {File} video - Video file to analyse.
   * @param {string} userId - Opaque, customer-provided identity key for the user.
   * @param {string} phrase - Set of numbers/words the user speaks in the video.
   * @param {Object} [props] - Optional properties for the request.
   * @param {string} [props.sessionId] - Session ID for combined scoring.
   * @param {string} [props.trigger] - Contextual trigger event name (e.g. 'authentication').
   * @param {string} [props.vocabulary] - Vocabulary hint for speech recognition (e.g. 'en_digits').
   * @param {VerificationService[]} [props.excludeServices] - Services to skip from the pipeline.
   * @returns {Promise<ApiResponse<SuccessEnvelope<LivenessData>>>} - A promise resolving to the liveness envelope.
   * @throws {Error|BiometryApiError} - If required parameters are missing or the request fails.
   */
  async liveness(
    video: File,
    userId: string,
    phrase: string,
    props?: {
      sessionId?: string,
      trigger?: string,
      vocabulary?: string,
      excludeServices?: VerificationService[],
    }
  ): Promise<ApiResponse<SuccessEnvelope<LivenessData>>> {
    if (!video) throw new Error('Video is required.');
    if (!userId) throw new Error('User ID is required.');
    if (!phrase) throw new Error('Phrase is required.');

    const formData = BiometrySDK.buildMultipart(
      {
        user_id: userId,
        phrase,
        session_id: props?.sessionId,
        trigger: props?.trigger,
        vocabulary: props?.vocabulary,
        services: props?.excludeServices?.length ? { exclude: props.excludeServices } : undefined,
      },
      { video }
    );

    return await this.request<SuccessEnvelope<LivenessData>>(
      `${BiometrySDK.GATEWAY_V2}/liveness`,
      'POST',
      formData
    );
  }

  /**
   * Verifies a user's face from a video/image against their enrolled face template.
   * Replaces part of the v1 `processVideo` flow.
   *
   * @param {File} video - Portrait video/image of the user.
   * @param {string} userId - Opaque, customer-provided identity key for the user.
   * @param {string} phrase - Set of numbers/words the user speaks in the video.
   * @param {Object} [props] - Optional properties for the request.
   * @param {string} [props.sessionId] - Session ID for combined scoring.
   * @param {string} [props.vocabulary] - Vocabulary hint for speech recognition (e.g. 'en_digits').
   * @returns {Promise<ApiResponse<SuccessEnvelope<FaceVerifyData>>>} - A promise resolving to the face verify envelope.
   * @throws {Error|BiometryApiError} - If required parameters are missing or the request fails.
   */
  async faceVerify(
    video: File,
    userId: string,
    phrase: string,
    props?: {
      sessionId?: string,
      vocabulary?: string,
    }
  ): Promise<ApiResponse<SuccessEnvelope<FaceVerifyData>>> {
    if (!video) throw new Error('Video is required.');
    if (!userId) throw new Error('User ID is required.');
    if (!phrase) throw new Error('Phrase is required.');

    const formData = BiometrySDK.buildMultipart(
      { user_id: userId, phrase, session_id: props?.sessionId, vocabulary: props?.vocabulary },
      { video }
    );

    return await this.request<SuccessEnvelope<FaceVerifyData>>(
      `${BiometrySDK.GATEWAY_V2}/face-verify`,
      'POST',
      formData
    );
  }

  /**
   * Verifies a user's voice from an audio/video file against their enrolled voice template.
   * Replaces part of the v1 `processVideo` flow.
   *
   * @param {File} voice - Audio/video file containing the user's speech.
   * @param {string} userId - Opaque, customer-provided identity key for the user.
   * @param {string} phrase - Set of numbers/words the user speaks.
   * @param {Object} [props] - Optional properties for the request.
   * @param {string} [props.sessionId] - Session ID for combined scoring.
   * @param {string} [props.vocabulary] - Vocabulary hint for speech recognition (e.g. 'en_digits').
   * @returns {Promise<ApiResponse<SuccessEnvelope<VoiceVerifyData>>>} - A promise resolving to the voice verify envelope.
   * @throws {Error|BiometryApiError} - If required parameters are missing or the request fails.
   */
  async voiceVerify(
    voice: File,
    userId: string,
    phrase: string,
    props?: {
      sessionId?: string,
      vocabulary?: string,
    }
  ): Promise<ApiResponse<SuccessEnvelope<VoiceVerifyData>>> {
    if (!voice) throw new Error('Voice file is required.');
    if (!userId) throw new Error('User ID is required.');
    if (!phrase) throw new Error('Phrase is required.');

    const formData = BiometrySDK.buildMultipart(
      { user_id: userId, phrase, session_id: props?.sessionId, vocabulary: props?.vocabulary },
      { voice }
    );

    return await this.request<SuccessEnvelope<VoiceVerifyData>>(
      `${BiometrySDK.GATEWAY_V2}/voice-verify`,
      'POST',
      formData
    );
  }
}
