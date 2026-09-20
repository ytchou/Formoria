'use server'

import { runWithAuditContext } from '@/lib/audit/context'
import { headers } from 'next/headers'
import {
  normalizeEmail,
  validateEmail,
} from '@/lib/services/newsletter'
import { requestNewsletterSubscription } from '@/lib/services/marketing-email-consent'
import { rateLimit } from '@/lib/security/rate-limiter'
import { createServiceClient } from '@/lib/supabase/service'
import { isHoneypotFilled, parseSubscribeForm } from './newsletter-helpers'
import { verifyStagingSessionHeaders } from '@/lib/security/staging-session'

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 5

export type SubscribeNewsletterState = {
  success?: true
  error?: string
}

function getRequestIp(headerList: Awaited<ReturnType<typeof headers>>): string {
  return headerList.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

export async function subscribeToNewsletter(
  _prevState: unknown,
  formData: FormData
): Promise<SubscribeNewsletterState> {
  return runWithAuditContext({}, async () => {
    if (isHoneypotFilled(formData)) {
      return { success: true }
    }

    const { email, interests, locale } = parseSubscribeForm(formData)
    const normalizedEmail = normalizeEmail(email)
    const headerList = await headers()
    const hasStagingE2ESession = Boolean(
      await verifyStagingSessionHeaders(headerList),
    )
    const ip = getRequestIp(headerList)
    const identifier = validateEmail(normalizedEmail) ? normalizedEmail : ip
    const limit = hasStagingE2ESession
      ? { allowed: true }
      : await rateLimit(identifier, {
          windowMs: RATE_LIMIT_WINDOW_MS,
          maxRequests: RATE_LIMIT_MAX_REQUESTS,
          prefix: 'newsletter:subscribe',
        })

    if (!limit.allowed) {
      return { error: 'Too many requests' }
    }

    if (!validateEmail(normalizedEmail)) {
      return { error: 'Invalid email' }
    }

    try {
      const supabase = createServiceClient()
      const status = await requestNewsletterSubscription(
        supabase,
        {
          email: normalizedEmail,
          interests,
          locale,
          source: 'homepage_newsletter',
        },
        { suppressDelivery: hasStagingE2ESession },
      )

      if (status === 'failed') {
        return { error: 'Unable to send confirmation email' }
      }

      return { success: true }
    } catch (err) {
      console.error('[newsletter:subscribe]', err)
      return { error: err instanceof Error ? err.message : 'Unable to subscribe' }
    }
  });
}
