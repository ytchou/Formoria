export type ValidationErrorCode =
  | 'brand_name_empty'
  | 'website_url_invalid'
  | 'submitter_email_invalid'
  | 'description_too_short'

export type ValidationResult = {
  isValid: boolean
  errors: ValidationErrorCode[]
}
