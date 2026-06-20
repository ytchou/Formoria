'use server'

import { headers } from 'next/headers'
import { buildNewsletterConfirmEmail } from '@emails/templates/newsletter-confirm'
import { sendEmail } from '@/lib/email/send'
import {
  createSubscriber,
  normalizeEmail,
  normalizeInterests,
  validateEmail,
} from '@/lib/services/newsletter'
import { rateLimit } from '@/lib/security/rate-limiter'
import { createServiceClient } from '@/lib/supabase/server'
import { isHoneypotFilled, parseSubscribeForm } from './newsletter-helpers'

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 5

export type SubscribeNewsletterState = {
  success?: true
  error?: string
}

async function getRequestIp(): Promise<string> {
  const headerList = await headers()
  return headerList.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

export async function subscribeToNewsletter(
  _prevState: unknown,
  formData: FormData
): Promise<SubscribeNewsletterState> {
  if (isHoneypotFilled(formData)) {
    return { success: true }
  }

  const { email, interests, locale } = parseSubscribeForm(formData)
  const normalizedEmail = normalizeEmail(email)
  const ip = await getRequestIp()
  const identifier = validateEmail(normalizedEmail) ? normalizedEmail : ip
  const limit = await rateLimit(identifier, {
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
    const normalizedInterests = normalizeInterests(interests)
    const result = await createSubscriber(supabase, {
      email: normalizedEmail,
      interests: normalizedInterests,
      locale,
    })

    if (result.needsConfirmation) {
      sendEmail(await buildNewsletterConfirmEmail({
        to: result.subscriber.email,
        confirmToken: result.subscriber.confirm_token,
        interests: result.subscriber.interests ?? normalizedInterests,
        locale: result.subscriber.locale,
      }))
    }

    return { success: true }
  } catch (err) {
    console.error('[newsletter:subscribe]', err)
    return { error: err instanceof Error ? err.message : 'Unable to subscribe' }
  }
}
