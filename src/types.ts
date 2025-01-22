export interface ConsentResponse {
  is_consent_given: boolean;
  user_fullname: string;
}

export interface VoiceOnboardingResponse {
  status: "good" | "qafailed" | "enrolled";
}

export interface DocAuthInfo {
  document_type: string; // e.g., National Identification Card
  country_code: string; // e.g., KGZ
  nationality_code: string; // e.g., KGZ
  nationality_name: string; // e.g., KYRGYZSTANI
  sex: string; // e.g., MALE
  first_name: string; // e.g., John
  father_name: string; // e.g., Yohan
  last_name: string; // e.g., Doe
  expiry_date: string; // e.g., 2028-08-01
  document_number: string; // e.g., ID0654321
  birth_date: string; // e.g., 1990-01-01
  portrait_photo: string; // Base64 string
  signature: string; // Base64 string
  document_category: string; // e.g., National Identification Card
  issuing_state: string; // e.g., Not available
  front_document_type_id: string; // e.g., KGZID0123A
  contains_rfid: boolean; // true/false
  errors?: string[]; // List of error messages, if any
}

export interface FaceOnboardingResponse {
  data: {
    onboard_result: FaceOnboardingResult;
    document_auth?: DocAuthInfo;
  },
  message: string;
}

export interface FaceOnboardingResult {
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
