import type { ValidationErrorCode, ValidationResult } from './types'

export type SubmissionData = {
  brandName: string | null | undefined
  websiteUrl: string | null | undefined
  submitterEmail: string | null | undefined
  description: string | null | undefined
}

export const MIN_DESCRIPTION_LENGTH = 20

const URL_REGEX = /^https?:\/\/.+\..+/
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateSubmission(data: SubmissionData): ValidationResult {
  const errors: ValidationErrorCode[] = []

  if (!data.brandName || data.brandName.trim().length === 0) {
    errors.push('brand_name_empty')
  }

  if (data.websiteUrl != null && !URL_REGEX.test(data.websiteUrl)) {
    errors.push('website_url_invalid')
  }

  if (!data.submitterEmail || !EMAIL_REGEX.test(data.submitterEmail)) {
    errors.push('submitter_email_invalid')
  }

  if (!data.description || data.description.length < MIN_DESCRIPTION_LENGTH) {
    errors.push('description_too_short')
  }

  return { isValid: errors.length === 0, errors }
}
