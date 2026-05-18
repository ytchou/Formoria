import type { EmailMessage } from './types'
import type { ValidationErrorCode } from '../validation/types'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const FROM_ADDRESS = 'MIT Map <noreply@mitmap.tw>'

const ERROR_LABELS: Record<ValidationErrorCode, string> = {
  brand_name_empty: 'Brand name is required',
  website_url_invalid: 'Website URL is not valid',
  submitter_email_invalid: 'Submitter email is not valid',
  description_too_short: 'Description is too short (minimum 20 characters)',
}

export function buildApprovalEmail(params: {
  submitterEmail: string
  brandName: string
  brandSlug: string
  siteUrl: string
}): EmailMessage {
  const brandUrl = `${params.siteUrl}/brands/${params.brandSlug}`

  return {
    to: params.submitterEmail,
    from: FROM_ADDRESS,
    subject: `Your brand "${escapeHtml(params.brandName)}" has been approved on MIT Map`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Your brand has been approved!</h2>
        <p>Great news -- <strong>${escapeHtml(params.brandName)}</strong> is now listed on MIT Map.</p>
        <p>You can view your brand page here:</p>
        <p><a href="${brandUrl}" style="color: #2563eb;">${brandUrl}</a></p>
        <p>Thank you for contributing to the Made in Taiwan directory.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #6b7280; font-size: 14px;">MIT Map -- Made in Taiwan Brand Directory</p>
      </div>
    `.trim(),
  }
}

export function buildRejectionEmail(params: {
  submitterEmail: string
  brandName: string
  reviewerNotes: string | null
}): EmailMessage {
  const notesSection =
    params.reviewerNotes != null
      ? `
        <p><strong>Reviewer notes:</strong></p>
        <blockquote style="border-left: 3px solid #d1d5db; padding-left: 12px; color: #374151;">
          ${escapeHtml(params.reviewerNotes)}
        </blockquote>`
      : ''

  return {
    to: params.submitterEmail,
    from: FROM_ADDRESS,
    subject: `Update on your brand submission "${escapeHtml(params.brandName)}" -- MIT Map`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Update on your submission</h2>
        <p>Thank you for submitting <strong>${escapeHtml(params.brandName)}</strong> to MIT Map.</p>
        <p>After review, we were unable to approve this submission at this time.</p>
        ${notesSection}
        <p>You are welcome to resubmit with updated information.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #6b7280; font-size: 14px;">MIT Map -- Made in Taiwan Brand Directory</p>
      </div>
    `.trim(),
  }
}

export function buildIncompleteSubmissionEmail(params: {
  submitterEmail: string
  brandName: string
  missingFields: ValidationErrorCode[]
  siteUrl: string
}): EmailMessage {
  const fieldList = params.missingFields
    .map((code) => `<li>${ERROR_LABELS[code]}</li>`)
    .join('\n')

  return {
    to: params.submitterEmail,
    from: FROM_ADDRESS,
    subject: `Action needed: your submission for "${escapeHtml(params.brandName)}" -- MIT Map`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Your submission needs attention</h2>
        <p>Thank you for submitting <strong>${escapeHtml(params.brandName)}</strong> to MIT Map.</p>
        <p>We found the following issues with your submission:</p>
        <ul>${fieldList}</ul>
        <p>Please update your submission so we can continue the review process.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #6b7280; font-size: 14px;">MIT Map -- Made in Taiwan Brand Directory</p>
      </div>
    `.trim(),
  }
}
