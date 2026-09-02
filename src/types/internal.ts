export interface ApiResponse<T> {
  body: T;
  headers: Record<string, string>;
}

/**
 * Metadata attached to every API v2 response.
 */
export interface ResponseMeta {
  request_id?: string;
  message?: string;
}

/**
 * Scoring decision computed for the request when a scoring system applies to the
 * API key. Absent when no scoring system is configured.
 */
export interface Decision {
  status?: string;
  score?: number;
  reasons?: string[];
}

/**
 * Standard API v2 success envelope. The endpoint-specific payload lives in `data`
 * (omitted when the operation returns no data).
 */
export interface SuccessEnvelope<T = unknown> {
  data?: T;
  decision?: Decision;
  meta: ResponseMeta;
}

/**
 * `message` is a human-readable string, or a field-error array for validation
 * failures.
 */
export interface ApiErrorBody {
  code: string;
  message: string | Array<{ field?: string; message: string }>;
}

export interface ErrorEnvelope {
  error: ApiErrorBody;
  meta?: ResponseMeta;
}
