// API v2 verification payloads. The v1 `process-video` endpoint was split into
// three v2 endpoints (`/liveness`, `/face-verify`, `/voice-verify`); each returns
// only the raw results of the services enabled for the API key.

type ServiceResult = Record<string, any>;

/** Services that can be excluded from the `/liveness` pipeline. */
export type VerificationService =
  | 'face_liveness_detection'
  | 'active_speaker_detection'
  | 'visual_speech_recognition'
  | 'face_recognition'
  | 'voice_recognition';

/** `data` returned by POST /v2/liveness. */
export interface LivenessData {
  face_liveness_detection?: ServiceResult;
  active_speaker_detection?: ServiceResult;
  visual_speech_recognition?: ServiceResult;
  [key: string]: any;
}

/** `data` returned by POST /v2/face-verify. */
export interface FaceVerifyData {
  face_recognition?: ServiceResult;
  [key: string]: any;
}

/** `data` returned by POST /v2/voice-verify. */
export interface VoiceVerifyData {
  voice_recognition?: ServiceResult;
  [key: string]: any;
}
