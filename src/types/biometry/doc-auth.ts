type Base64String = string & { readonly __brand: unique symbol };

export interface DocAuthResponse {
  data: DocAuthInfo;
  scoring_result: string;
  message: string;
}

export interface DocAuthInfo {
  document_type: string;
  country_code: string;
  nationality_code: string;
  nationality_name: string;
  sex: string;
  first_name: string;
  father_name: string;
  last_name: string;
  expiry_date: string;
  document_number: string;
  birth_date: string;
  portrait_photo: Base64String;
  signature: Base64String;
  document_category: string;
  issuing_state: string;
  front_document_type_id: string;
  contains_rfid: boolean;
  face_image_base64?: string;
  current_result?: string;
  mrz_validation?: MRZValidation;
  errors?: string[];
}

export interface MRZValidation {
  has_mrz: boolean;
  raw_mrz?: string;
  check_digits_valid: boolean;
  fields_match: boolean;
  discrepancies?: string[];
  validation_performed: boolean;
}
