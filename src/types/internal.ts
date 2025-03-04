export interface ApiResponse<T> {
  body: T;
  headers: Record<string, string>;
}