import { corsHeaders } from '../_shared/cors.ts'
import { createServiceClient } from '../_shared/supabase-client.ts'
import { verifyCronAuth } from '../_shared/auth.ts'

// ---------------------------------------------------------------------------
// Validation (copied from src/lib/validation/submission-rules.ts for Deno)
// ---------------------------------------------------------------------------

type ValidationErrorCode =
  | 'brand_name_empty'
  | 'website_url_invalid'
  | 'submitter_email_invalid'
  | 'description_too_short'

type ValidationResult = { isValid: boolean; errors: ValidationErrorCode[] }

const MIN_DESCRIPTION_LENGTH = 20
const URL_REGEX = /^https?:\/\/.+\..+/
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validateSubmission(data: {
  brandName: string | null
  websiteUrl: string | null
  submitterEmail: string | null
  description: string | null
}): ValidationResult {
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

// ---------------------------------------------------------------------------
// Email helpers (copied from src/lib/email/ for Deno)
// ---------------------------------------------------------------------------

type EmailMessage = {
  to: string
  from: string
  subject: string
  html: string
  replyTo?: string
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const FROM_ADDRESS = 'Formoria <noreply@formoria.com>'
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://formoria.com'

const ERROR_LABELS: Record<ValidationErrorCode, string> = {
  brand_name_empty: 'Brand name is required',
  website_url_invalid: 'Website URL is not valid',
  submitter_email_invalid: 'Submitter email is not valid',
  description_too_short: 'Description is too short (minimum 20 characters)',
}

function buildApprovalEmail(params: {
  submitterEmail: string
  brandName: string
  brandSlug: string
}): EmailMessage {
  const brandUrl = `${SITE_URL}/brands/${params.brandSlug}`
  return {
    to: params.submitterEmail,
    from: FROM_ADDRESS,
    subject: `Your brand "${escapeHtml(params.brandName)}" has been approved on Formoria`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Your brand has been approved!</h2>
        <p>Great news -- <strong>${escapeHtml(params.brandName)}</strong> is now listed on Formoria.</p>
        <p>You can view your brand page here:</p>
        <p><a href="${brandUrl}" style="color: #2563eb;">${brandUrl}</a></p>
        <p>Thank you for contributing to the Made in Taiwan directory.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #6b7280; font-size: 14px;">Formoria -- Made in Taiwan Brand Directory</p>
      </div>
    `.trim(),
  }
}

function buildRejectionEmail(params: {
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
    subject: `Update on your brand submission "${escapeHtml(params.brandName)}" -- Formoria`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Update on your submission</h2>
        <p>Thank you for submitting <strong>${escapeHtml(params.brandName)}</strong> to Formoria.</p>
        <p>After review, we were unable to approve this submission at this time.</p>
        ${notesSection}
        <p>You are welcome to resubmit with updated information.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #6b7280; font-size: 14px;">Formoria -- Made in Taiwan Brand Directory</p>
      </div>
    `.trim(),
  }
}

function buildIncompleteSubmissionEmail(params: {
  submitterEmail: string
  brandName: string
  missingFields: ValidationErrorCode[]
}): EmailMessage {
  const fieldList = params.missingFields
    .map((code) => `<li>${ERROR_LABELS[code]}</li>`)
    .join('\n')

  return {
    to: params.submitterEmail,
    from: FROM_ADDRESS,
    subject: `Action needed: your submission for "${escapeHtml(params.brandName)}" -- Formoria`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Your submission needs attention</h2>
        <p>Thank you for submitting <strong>${escapeHtml(params.brandName)}</strong> to Formoria.</p>
        <p>We found the following issues with your submission:</p>
        <ul>${fieldList}</ul>
        <p>Please update your submission so we can continue the review process.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #6b7280; font-size: 14px;">Formoria -- Made in Taiwan Brand Directory</p>
      </div>
    `.trim(),
  }
}

// ---------------------------------------------------------------------------
// Resend email sender
// ---------------------------------------------------------------------------

async function sendEmail(message: EmailMessage): Promise<{ success: boolean; error?: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) {
    return { success: false, error: 'RESEND_API_KEY not configured' }
  }

  const body: Record<string, unknown> = {
    from: message.from,
    to: [message.to],
    subject: message.subject,
    html: message.html,
  }
  if (message.replyTo) {
    body.reply_to = message.replyTo
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    return { success: false, error: `Resend API error ${response.status}: ${text}` }
  }

  return { success: true }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Auth check
  if (!verifyCronAuth(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const startTime = Date.now()
  const batchErrors: string[] = []
  let validatedCount = 0
  let notifiedCount = 0

  try {
    const supabase = createServiceClient()

    // Parse request body for triggered_by
    let triggeredBy = 'pg_cron'
    try {
      const body = await req.json()
      if (body.triggered_by === 'manual') {
        triggeredBy = 'manual'
      }
    } catch {
      // No body or invalid JSON -- default to pg_cron
    }

    // ------------------------------------------------------------------
    // Phase A: Validate pending submissions
    // ------------------------------------------------------------------
    const { data: pendingRows, error: pendingError } = await supabase
      .from('brand_submissions')
      .select('*')
      .eq('status', 'pending')
      .is('validation_status', null)

    if (pendingError) {
      batchErrors.push(`Phase A query error: ${pendingError.message}`)
    } else if (pendingRows) {
      for (const row of pendingRows) {
        const result = validateSubmission({
          brandName: row.brand_name,
          websiteUrl: row.website_url,
          submitterEmail: row.submitter_email,
          description: row.description,
        })

        const validationStatus = result.isValid ? 'valid' : 'incomplete'
        const validationErrors = result.isValid ? null : result.errors

        const { error: updateError } = await supabase
          .from('brand_submissions')
          .update({
            validation_status: validationStatus,
            validation_errors: validationErrors,
          })
          .eq('id', row.id)

        if (updateError) {
          batchErrors.push(`Validation update failed for ${row.id}: ${updateError.message}`)
          continue
        }

        validatedCount++

        // Send incomplete notification if invalid and has email
        if (!result.isValid && row.submitter_email) {
          const email = buildIncompleteSubmissionEmail({
            submitterEmail: row.submitter_email,
            brandName: row.brand_name,
            missingFields: result.errors,
          })

          const sendResult = await sendEmail(email)
          if (!sendResult.success) {
            batchErrors.push(`Incomplete email failed for ${row.id}: ${sendResult.error}`)
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // Phase B: Notify reviewed submissions
    // ------------------------------------------------------------------
    const { data: reviewedRows, error: reviewedError } = await supabase
      .from('brand_submissions')
      .select('*')
      .in('status', ['approved', 'rejected'])
      .not('reviewed_at', 'is', null)
      .is('notified_at', null)

    if (reviewedError) {
      batchErrors.push(`Phase B query error: ${reviewedError.message}`)
    } else if (reviewedRows) {
      for (const row of reviewedRows) {
        if (!row.submitter_email) {
          batchErrors.push(`Skipped notification for ${row.id}: no submitter email`)
          continue
        }

        let email: EmailMessage

        if (row.status === 'approved') {
          // Look up actual brand slug from brands table if linked
          let brandSlug: string
          if (row.brand_id) {
            const { data: brand } = await supabase
              .from('brands')
              .select('slug')
              .eq('id', row.brand_id)
              .single()
            brandSlug = brand?.slug ?? row.brand_name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
          } else {
            // Fallback: generate slug from name (brand not yet created)
            brandSlug = row.brand_name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
          }

          email = buildApprovalEmail({
            submitterEmail: row.submitter_email,
            brandName: row.brand_name,
            brandSlug,
          })
        } else {
          email = buildRejectionEmail({
            submitterEmail: row.submitter_email,
            brandName: row.brand_name,
            reviewerNotes: row.reviewer_notes,
          })
        }

        const sendResult = await sendEmail(email)

        if (!sendResult.success) {
          // Leave notified_at NULL for retry on next run
          batchErrors.push(`Notification email failed for ${row.id}: ${sendResult.error}`)
          continue
        }

        // Mark as notified
        const { error: notifyError } = await supabase
          .from('brand_submissions')
          .update({ notified_at: new Date().toISOString() })
          .eq('id', row.id)

        if (notifyError) {
          batchErrors.push(`Notified_at update failed for ${row.id}: ${notifyError.message}`)
          continue
        }

        notifiedCount++
      }
    }

    // ------------------------------------------------------------------
    // Log to batch_processing_log
    // ------------------------------------------------------------------
    const durationMs = Date.now() - startTime

    await supabase.from('batch_processing_log').insert({
      validated: validatedCount,
      notified: notifiedCount,
      errors: batchErrors,
      duration_ms: durationMs,
      triggered_by: triggeredBy,
    })

    const responseBody = {
      validated: validatedCount,
      notified: notifiedCount,
      errors: batchErrors,
      duration_ms: durationMs,
    }

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    batchErrors.push(`Fatal: ${message}`)

    const durationMs = Date.now() - startTime

    // Try to log even on fatal error
    try {
      const supabase = createServiceClient()
      await supabase.from('batch_processing_log').insert({
        validated: validatedCount,
        notified: notifiedCount,
        errors: batchErrors,
        duration_ms: durationMs,
        triggered_by: 'pg_cron',
      })
    } catch {
      // Logging failed too -- nothing we can do
    }

    return new Response(JSON.stringify({ error: message, errors: batchErrors }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
