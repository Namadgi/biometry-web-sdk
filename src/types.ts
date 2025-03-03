export enum BiometryAttributes {
  ApiKey = 'api-key',
  UserFullname = 'user-fullname',
}

export enum BiometryEnrollmentState {
  Loading = 'loading',
  Success = 'success',
  ErrorNoFace = 'error-no-face',
  ErrorMultipleFaces = 'error-multiple-faces',
  ErrorNotCentered = 'error-not-centered',
  ErrorOther = 'error-other',
}

export interface ConsentResponse {
  is_consent_given: boolean;
  user_fullname: string;
}

export interface VoiceEnrollmentResponse {
  status: "good" | "qafailed" | "enrolled";
}

type Base64String = string & { readonly __brand: unique symbol };

export interface DocAuthInfo {
  document_type: string;
  country_code: string;
  nationality_code: string;
  nationality_name: string;
  sex: string;
  first_name: string;
  father_name: string;
  last_name: string;
  expiry_date: string;
  document_number: string;
  birth_date: string;
  portrait_photo: Base64String;
  signature: Base64String;
  document_category: string;
  issuing_state: string;
  front_document_type_id: string;
  contains_rfid: boolean;
  errors?: string[]; // List of error messages, if any
}

export interface FaceEnrollmentResponse {
  data: {
    enroll_result: FaceEnrollmentResult;
    document_auth?: DocAuthInfo;
  },
  message?: string;
  error?: string;
  scoring_result?: string;
}

export interface FaceEnrollmentResult {
  code: number;
  description: string;
}

export interface FaceMatchResponse {
  code: number;
  result: number;
  description: string;
  anchor: {
    code: number;
    description: string;
  };
  target: {
    code: number;
    description: string;
  };
}

export interface ProcessVideoResponse {
  data: {
    "Active Speaker Detection": {
      code: number;
      description: string;
      result: number;
    };
    "Face Liveness Detection": {
      code: number;
      description: string;
      result: boolean;
    };
    "Face Recognition": {
      code: number;
      description: string;
    };
    "Visual Speech Recognition": {
      code: number;
      description: string;
      result: string;
    };
    "Voice Recognition": {
      status: string;
      id: string;
      score: number;
      imposter_prob: number;
      log_odds: string;
    };
  };
  result_conditions: {
    failed_conditions: any[];
    failed_refer_conditions: any[];
    status: string;
  };
  message: string;
}

export interface ApiResponse<T> {
  data: T;
  headers: Record<string, string>;
}
