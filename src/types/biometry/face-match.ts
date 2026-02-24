export interface FaceMatchResponse {
  data: FaceMatchData;
  scoring_result: Record<string, any>;
  decision_reasons: string[];
  message: string;
}

export interface FaceMatchData {
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
