import { DocAuthInfo } from "./doc-auth";

// TODO: add all fields for voice enrollment
export interface VoiceEnrollmentResponse {
  status: "good" | "qafailed" | "enrolled";
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