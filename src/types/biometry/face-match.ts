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