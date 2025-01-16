export interface ConsentResponse {
  is_consent_given: boolean;
  user_fullname: string;
}

export interface VoiceOnboardingResponse {
  status: "good" | "qafailed" | "enrolled";
}

export interface FaceOnboardingResponse {
  onboard_result: {
    code: number;
    description: string
  },
  document_auth: {
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
    portrait_photo: string;
    signature: string;
    document_category: string;
    issuing_state: string;
    front_document_type_id: string;
    contains_rfid: boolean;
  },
  message: string;
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
