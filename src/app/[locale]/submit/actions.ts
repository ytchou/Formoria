'use server'

import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import {
  createOwnerSubmissionSchema,
  createRecommendationSubmissionSchema,
  type SubmissionFormData,
} from '@/lib/validations/submission'
import { submitBrandForReview } from '@/lib/services/submission-pipeline'
import { cleanBrandName } from '@/lib/services/brand-cleanup'
import { createClient } from '@/lib/supabase/server'
import { verifyTurnstileToken } from '@/lib/security/turnstile'
import { createInMemoryRateLimiter } from '@/lib/security/rate-limiter'
import type { SourceAttribution } from '@/lib/types/submission'
import { getUserBrand } from '@/lib/services/brand-owners'
import {
  buildGuestSubmissionEmail,
  checkBrandDuplicates,
} from '@/lib/services/submissions'

// Per-user in-action rate limiter for brand submissions (5 per 60s)
const ownerSubmissionRateLimiter = createInMemoryRateLimiter()
const guestRecommendationRateLimiter = createInMemoryRateLimiter()

type SubmitBrandInput = SubmissionFormData & {
  guestEmail?: string
  sourceAttribution?: SourceAttribution
}

function getRequestIp(headerStore: Awaited<ReturnType<typeof headers>>) {
  return headerStore.get('cf-connecting-ip') ?? headerStore.get('x-forwarded-for')?.split(',').at(0)?.trim() ?? 'unknown'
}

function getRequestHost(headerStore: Awaited<ReturnType<typeof headers>>) {
  return headerStore.get('x-forwarded-host') ?? headerStore.get('host') ?? undefined
}

function isDnsResolutionError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  const cause = (error as { cause?: { code?: string } }).cause
  return (
    error.message.includes('ENOTFOUND') ||
    error.message.includes('getaddrinfo ENOTFOUND') ||
    cause?.code === 'ENOTFOUND'
  )
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

export async function submitRecommendation(
  data: SubmitBrandInput
): Promise<{ error?: string } | undefined> {
  const t = await getTranslations('submit.errors')
  const tSubmit = await getTranslations('submit')
  const tValidation = (key: string) => tSubmit(key as Parameters<typeof tSubmit>[0])

  try {
    const schema = createRecommendationSubmissionSchema(tValidation)
    const parsed = schema.parse(data)

    if (parsed.honeypot) {
      return undefined
    }

    const headerStore = await headers()
    const ip = getRequestIp(headerStore)
    const rateResult = guestRecommendationRateLimiter.check(ip, 60_000, 5)
    if (!rateResult.allowed) {
      return { error: t('rateLimit') }
    }

    const turnstile = await verifyTurnstileToken(
      parsed.turnstileToken,
      ip,
      getRequestHost(headerStore),
    )
    if (!turnstile.success) {
      return { error: t('validation') }
    }

    const duplicates = await checkBrandDuplicates(parsed.name)
    if (duplicates.nameMatches.length > 0) {
      return { error: tSubmit('fields.nameDuplicateTitle') }
    }

    await submitBrandForReview({
      intent: 'recommend',
      brandName: parsed.name,
      websiteUrl: parsed.website,
      description: parsed.description?.trim() || undefined,
      heroImageUrl: parsed.heroImageUrl || undefined,
      isBrandOwner: false,
      pdpaConsent: parsed.pdpaConsent,
      sourceAttribution: parsed.sourceAttribution,
      submitterEmail: parsed.guestEmail?.trim() || buildGuestSubmissionEmail(),
    }, { useServiceRole: true })

    return undefined
  } catch (err) {
    console.error('Submit recommendation error:', err)
    if (isDnsResolutionError(err)) {
      console.error('Submit recommendation DNS resolution failure:', err)
      return { error: t('unexpected') }
    }
    return { error: t('unexpected') }
  }
}

export async function submitOwnerBrand(
  data: SubmitBrandInput
): Promise<{ error?: string; ownershipAdjusted?: boolean } | undefined> {
  const t = await getTranslations('submit.errors')
  const tSubmit = await getTranslations('submit')
  const tValidation = (key: string) => tSubmit(key as Parameters<typeof tSubmit>[0])

  try {
    const schema = createOwnerSubmissionSchema(tValidation)
    const parsed = schema.parse(data)

    if (parsed.honeypot) {
      return undefined
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { error: t('notAuthenticated') }
    }

    const rateResult = ownerSubmissionRateLimiter.check(user.id, 60_000, 5)
    if (!rateResult.allowed) {
      return { error: t('rateLimit') }
    }

    const headerStore = await headers()
    const turnstile = await verifyTurnstileToken(
      parsed.turnstileToken,
      undefined,
      getRequestHost(headerStore),
    )
    if (!turnstile.success) {
      return { error: t('validation') }
    }

    const ownershipAdjusted = Boolean(await getUserBrand(user.id))

    await submitBrandForReview({
      intent: ownershipAdjusted ? 'recommend' : 'owner_claim',
      brandName: parsed.name,
      websiteUrl: parsed.website,
      description: parsed.description?.trim() || undefined,
      heroImageUrl: parsed.heroImageUrl || undefined,
      isBrandOwner: !ownershipAdjusted,
      pdpaConsent: parsed.pdpaConsent,
      submitterEmail: user.email ?? '',
      submitterName: user.user_metadata?.full_name ?? undefined,
      socialLinks: parsed.socialLinks ?? null,
      purchaseLinks: parsed.purchaseLinks ?? null,
      mitSmileCert: parsed.mitSmileCert || undefined,
    })

    return ownershipAdjusted ? { ownershipAdjusted: true } : undefined
  } catch (err) {
    console.error('Submit owner brand error:', err)
    if (
      isDnsResolutionError(err)
    ) {
      console.error('Submit owner brand DNS resolution failure:', err)
      return { error: t('unexpected') }
    }
    return { error: t('unexpected') }
  }
}
