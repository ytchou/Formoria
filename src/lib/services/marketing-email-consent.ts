import type { SupabaseClient } from '@supabase/supabase-js'
import { auditedCall } from '@/lib/audit'
import { buildNewsletterConfirmEmail } from '@emails/templates/newsletter-confirm'
import { sendEmail } from '@/lib/email/send'
import { createSubscriber } from '@/lib/services/newsletter'

export const MARKETING_CONSENT_VERSION = '2026-07-16'

type MarketingConsentSource =
  | 'homepage_newsletter'
  | 'guest_recommendation'
  | 'account_signup'
  | 'google_signup'
  | 'settings'

export type MarketingEnrollmentInput = {
  email: string
  userId?: string
  locale: string
  source: MarketingConsentSource
  newsletter: boolean
  interests?: string[]
}

export type MarketingEnrollmentResult = {
  newsletter: 'not_requested' | 'pending' | 'active' | 'failed'
}

export async function requestNewsletterSubscription(
  supabase: SupabaseClient,
  input: Pick<
    MarketingEnrollmentInput,
    'email' | 'locale' | 'source' | 'interests'
  >,
): Promise<'pending' | 'active' | 'failed'> {
  return auditedCall(
    { provider: 'email', operation: 'requestNewsletterSubscription', kind: 'service' },
    async () => {
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

  if (process.env.PLAYWRIGHT_TEST === 'true') {
    return 'pending'
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
    },
  )
}

export async function enrollInMarketingEmails(
  supabase: SupabaseClient,
  input: MarketingEnrollmentInput,
): Promise<MarketingEnrollmentResult> {
  return auditedCall(
    { provider: 'email', operation: 'enrollInMarketingEmails', kind: 'service' },
    async () => {
  if (!input.newsletter) {
    return { newsletter: 'not_requested' }
  }

  let newsletter: MarketingEnrollmentResult['newsletter']
  try {
    newsletter = await requestNewsletterSubscription(supabase, input)
  } catch (error) {
    console.error('[marketing-consent]', {
      category: 'newsletter',
      source: input.source,
      userId: input.userId ?? null,
      error: error instanceof Error ? error.message : String(error),
    })
    return { newsletter: 'failed' }
  }

  if (newsletter === 'failed') {
    console.error('[marketing-consent]', {
      category: 'newsletter',
      source: input.source,
      userId: input.userId ?? null,
      error: 'confirmation_delivery_failed',
    })
  }

  return { newsletter }
    },
  )
}
