// API v2 session payloads.

/** `data` returned by POST /v2/sessions. */
export interface SessionStartData {
  session_id: string;
}

export interface Session {
  id: string;
  project_id: string;
  user_id?: string;
  status: 'active' | 'ended';
  created_at?: string;
  ended_at?: string | null;
  [key: string]: any;
}
