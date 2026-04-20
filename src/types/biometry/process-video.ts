export interface ProcessVideoResponse {
  data: {
    "Active Speaker Detection"?: {
      code: number;
      description: string;
      result: number;
      score: number;
      error?: string;
    };
    "Face Liveness Detection"?: {
      code: number;
      description: string;
      result: boolean;
      score: number;
      error?: string;
    };
    "Face Recognition"?: {
      code: number;
      description: string;
      score: number;
      error?: string;
    };
    "Visual Speech Recognition"?: {
      code: number;
      description: string;
      result: string;
      score: number;
      error?: string;
    };
    "Voice Recognition"?: {
      status: string;
      id: string;
      score: number;
      imposter_prob: number;
      log_odds: string;
      error?: string;
    };
  };
  scoring_result: "pass" | "fail" | "refer";
  score?: number;
  decision_reasons?: string[];
  message: string;
}