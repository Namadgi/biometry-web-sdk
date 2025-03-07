import { DocAuthInfo } from "./doc-auth";

// VOICE ENROLLMENT
// TODO: add all fields for voice enrollment
export interface VoiceEnrollmentResponse {
  status: "good" | "qafailed" | "enrolled" | "error";
  qa_combined: QualityResultList | null;
  qa_list: QualityResultList[];
}

interface QualityResultList {
  results: (QualityResult | RecognitionResult)[];
  status: "good" | "fail";
}

interface QualityResult {
  status: "good" | "fail";
  property: string;
  value: number;
  op: string;
  threshold: number;
}

interface RecognitionResult {
  status: "good" | "fail";
  property: string;
  results: RecognitionHypothesis[];
}

interface RecognitionHypothesis {
  score: number;
  text: string;
}

// FACE ENROLLMENT
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