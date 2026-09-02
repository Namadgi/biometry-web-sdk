// API v2 face-match payload (`data` in the success envelope).
// Raw per-service results; only services enabled for the API key appear.
export interface FaceMatchData {
  face_recognition?: Record<string, any>;
  [key: string]: any;
}
