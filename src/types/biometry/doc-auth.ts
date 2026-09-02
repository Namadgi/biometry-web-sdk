// API v2 document authentication payload (`data` in the success envelope).
export interface DocAuthInfo {
  first_name?: string;
  last_name?: string;
  birth_date?: string;
  document_number?: string;
  expiry_date?: string;
  country_code?: string;
  document_category?: string;
  current_result?: string;
  /** Base64-encoded portrait extracted from the document. */
  portrait_photo?: string;
  [key: string]: any;
}
