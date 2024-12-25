export interface ConsentResponse {
  is_consent_given: boolean;
  user_fullname: string;
}

export interface VoiceOnboardingResponse {
  status: "good" | "qafailed" | "enrolled";
}

export interface FaceOnboardingResponse {
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
