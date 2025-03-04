export enum BiometryAttributes {
  ApiKey = 'api-key',
  UserFullname = 'user-fullname',
}

export enum BiometryEnrollmentState {
  Loading = 'loading',
  Success = 'success',
  ErrorNoFace = 'error-no-face',
  ErrorMultipleFaces = 'error-multiple-faces',
  ErrorNotCentered = 'error-not-centered',
  ErrorOther = 'error-other',
}
