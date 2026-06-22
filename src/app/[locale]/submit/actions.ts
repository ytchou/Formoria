'use server'

import { getTranslations } from 'next-intl/server'
import { createSubmissionSchema, type SubmissionFormData } from '@/lib/validations/submission'
import { submitBrandForReview } from '@/lib/services/submission-pipeline'
import { cleanBrandName } from '@/lib/services/brand-cleanup'
import { createClient } from '@/lib/supabase/server'
import { verifyTurnstileToken } from '@/lib/security/turnstile'
import { createInMemoryRateLimiter } from '@/lib/security/rate-limiter'
import type { SourceAttribution } from '@/lib/types/submission'

// Per-user in-action rate limiter for brand submissions (5 per 60s)
const submissionRateLimiter = createInMemoryRateLimiter()

type SubmitBrandInput = SubmissionFormData & {
  isOwner?: boolean
  sourceAttribution?: SourceAttribution
}

export async function suggestCleanName(name: string) {
  if (!name || name.length > 200) {
    return { suggestion: null, changed: false, patterns: [] as string[] }
  }

  const result = cleanBrandName(name)

  if (result.changed && result.confidence !== 'low') {
    return {
      suggestion: result.cleanedName,
      changed: true,
      patterns: result.patternsMatched,
    }
  }

  return { suggestion: null, changed: false, patterns: [] as string[] }
}

export async function submitBrand(
  data: SubmitBrandInput
): Promise<{ error: string } | undefined> {
  const t = await getTranslations('submit.errors')
  const tSubmit = await getTranslations('submit')
  // Wrap to satisfy the plain (key: string) => string Translator contract
  const tValidation = (key: string) => tSubmit(key as Parameters<typeof tSubmit>[0])

  try {
    // Server-side validation — schema switches based on isOwner flag
    const isOwner = data.isOwner ?? false
    const schema = createSubmissionSchema(isOwner, tValidation)
    const parsed = schema.parse(data)

    // Get authenticated user
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { error: t('notAuthenticated') }
    }

    // Honeypot check — silently succeed (don't reveal the trap to bots)
    if (parsed.honeypot) {
      return undefined
    }

    // Rate limit check per user
    const rateResult = submissionRateLimiter.check(user.id, 60_000, 5)
    if (!rateResult.allowed) {
      return { error: t('rateLimit') }
    }

    // Turnstile verification
    const turnstile = await verifyTurnstileToken(parsed.turnstileToken)
    if (!turnstile.success) {
      return { error: t('validation') }
    }

    await submitBrandForReview({
      name: parsed.name,
      website: parsed.website,
      region: parsed.region,
      isOwner,
      pdpaConsent: parsed.pdpaConsent,
      sourceAttribution: data.sourceAttribution ?? null,
      submitterEmail: user.email ?? '',
      submitterName: user.user_metadata?.full_name ?? undefined,
    })

    return undefined // Success — no error
  } catch (err) {
    console.error('Submit brand error:', err)
    return { error: t('unexpected') }
  }
}
