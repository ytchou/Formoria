import type { SupabaseClient } from '@supabase/supabase-js'
import { buildNewsletterConfirmEmail } from '@emails/templates/newsletter-confirm'
import { sendEmail } from '@/lib/email/send'
import { setLifecycleEmailPreference } from '@/lib/services/email-lifecycle'
import { createSubscriber } from '@/lib/services/newsletter'

export const MARKETING_CONSENT_VERSION = '2026-07-16'

export const MARKETING_CONSENT_SOURCES = [
  'homepage_newsletter',
  'guest_recommendation',
  'account_signup',
  'google_signup',
  'owner_quick_submission',
  'owner_detailed_submission',
  'brand_claim',
  'settings',
] as const

export type MarketingConsentSource =
  (typeof MARKETING_CONSENT_SOURCES)[number]

export type MarketingEnrollmentInput = {
  email: string
  userId?: string
  locale: string
  source: MarketingConsentSource
  newsletter: boolean
  lifecycle: boolean
  interests?: string[]
}

export type MarketingEnrollmentResult = {
  newsletter: 'not_requested' | 'pending' | 'active' | 'failed'
  lifecycle: 'not_requested' | 'on' | 'failed'
}

export async function requestNewsletterSubscription(
  supabase: SupabaseClient,
  input: Pick<
    MarketingEnrollmentInput,
    'email' | 'locale' | 'source' | 'interests'
  >,
): Promise<'pending' | 'active' | 'failed'> {
  const result = await createSubscriber(supabase, {
    email: input.email,
    interests: input.interests,
    locale: input.locale === 'en' ? 'en' : 'zh-TW',
    consentSource: input.source,
    consentVersion: MARKETING_CONSENT_VERSION,
  })

  if (!result.needsConfirmation) {
    return 'active'
  }

  const delivery = await sendEmail(
    await buildNewsletterConfirmEmail({
      to: result.subscriber.email,
      confirmToken: result.subscriber.confirm_token,
      unsubscribeToken: result.subscriber.unsubscribe_token,
      interests: result.subscriber.interests ?? ['curated-picks'],
      locale: result.subscriber.locale,
    }),
  )

  return delivery.success ? 'pending' : 'failed'
}

export async function enrollInMarketingEmails(
  supabase: SupabaseClient,
  input: MarketingEnrollmentInput,
): Promise<MarketingEnrollmentResult> {
  const newsletterPromise = input.newsletter
    ? requestNewsletterSubscription(supabase, input)
    : Promise.resolve<'not_requested'>('not_requested')
  const lifecyclePromise = input.lifecycle && input.userId
    ? setLifecycleEmailPreference(supabase, {
        userId: input.userId,
        enabled: true,
        consentSource: input.source,
        consentVersion: MARKETING_CONSENT_VERSION,
      }).then(() => 'on' as const)
    : Promise.resolve<'not_requested'>('not_requested')

  const [newsletterResult, lifecycleResult] = await Promise.allSettled([
    newsletterPromise,
    lifecyclePromise,
  ])

  if (newsletterResult.status === 'rejected') {
    console.error('[marketing-consent]', {
      category: 'newsletter',
      source: input.source,
      userId: input.userId ?? null,
      error: newsletterResult.reason instanceof Error
        ? newsletterResult.reason.message
        : String(newsletterResult.reason),
    })
  } else if (newsletterResult.value === 'failed') {
    console.error('[marketing-consent]', {
      category: 'newsletter',
      source: input.source,
      userId: input.userId ?? null,
      error: 'confirmation_delivery_failed',
    })
  }

  if (lifecycleResult.status === 'rejected') {
    console.error('[marketing-consent]', {
      category: 'lifecycle',
      source: input.source,
      userId: input.userId ?? null,
      error: lifecycleResult.reason instanceof Error
        ? lifecycleResult.reason.message
        : String(lifecycleResult.reason),
    })
  }

  return {
    newsletter: newsletterResult.status === 'fulfilled'
      ? newsletterResult.value
      : 'failed',
    lifecycle: lifecycleResult.status === 'fulfilled'
      ? lifecycleResult.value
      : 'failed',
  }
}
