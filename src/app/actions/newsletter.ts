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
import { createServiceClient } from '@/lib/supabase/server'
import { isHoneypotFilled, parseSubscribeForm } from './newsletter-helpers'

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 5
const rateLimitBuckets = new Map<string, number[]>()

export type SubscribeNewsletterState = {
  success?: true
  error?: string
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const windowStart = now - RATE_LIMIT_WINDOW_MS
  const recent = (rateLimitBuckets.get(ip) ?? []).filter((timestamp) => timestamp > windowStart)

  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    rateLimitBuckets.set(ip, recent)
    return false
  }

  recent.push(now)
  rateLimitBuckets.set(ip, recent)
  return true
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

  const ip = await getRequestIp()
  if (!checkRateLimit(ip)) {
    return { error: 'Too many requests' }
  }

  const { email, interests, locale } = parseSubscribeForm(formData)
  const normalizedEmail = normalizeEmail(email)

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
