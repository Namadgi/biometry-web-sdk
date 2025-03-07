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
  scoring_result: "pass" | "fail" | "refer";
  message: string;
}