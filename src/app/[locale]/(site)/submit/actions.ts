'use server'

import { runWithAuditContext } from '@/lib/audit/context'
import { headers } from 'next/headers'
import { getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import {
  createRecommendationSubmissionSchema,
  type SubmissionFormData,
} from '@/lib/validations/submission'
import { submitBrandForReview } from '@/lib/services/submission-pipeline'
import { cleanBrandName } from '@/lib/services/brand-cleanup'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyTurnstileToken } from '@/lib/security/turnstile'
import { createInMemoryRateLimiter } from '@/lib/security/rate-limiter'
import type { DuplicateCandidate, SourceAttribution } from '@/lib/types/submission'
import {
  buildGuestSubmissionEmail,
  checkBrandDuplicates,
} from '@/lib/services/submissions'
import { enrollInMarketingEmails } from '@/lib/services/marketing-email-consent'

const guestRecommendationRateLimiter = createInMemoryRateLimiter()
const nameInspectionRateLimiter = createInMemoryRateLimiter()

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
  return runWithAuditContext({}, async () => {
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
  });
}

type RecommendationInspection = Awaited<ReturnType<typeof suggestCleanName>> & {
  nameMatches: DuplicateCandidate[]
  websiteMatches: DuplicateCandidate[]
}

export async function inspectRecommendation(
  name: string,
  website?: string,
): Promise<RecommendationInspection> {
  return runWithAuditContext({}, async () => {
    const suggestion = await suggestCleanName(name)
    const empty = {
      ...suggestion,
      nameMatches: [] as DuplicateCandidate[],
      websiteMatches: [] as DuplicateCandidate[],
    }
    const parsed = z.string().trim().min(2).max(200).safeParse(name)

    if (!parsed.success) {
      return empty
    }

    const headerStore = await headers()
    const ip = getRequestIp(headerStore)
    // 20/min: this inspection now backs both the name and the website field, so a
    // visitor editing both would exhaust the previous 10/min budget mid-form.
    const rateResult = nameInspectionRateLimiter.check(ip, 60_000, 20)
    if (!rateResult.allowed) {
      return empty
    }

    const duplicates = await checkBrandDuplicates(parsed.data, website)
    return {
      ...suggestion,
      nameMatches: duplicates.nameMatches,
      websiteMatches: duplicates.websiteMatches,
    }
  });
}

export async function submitRecommendation(
  data: SubmitBrandInput,
  idempotencyKey?: string | null,
): Promise<{ error?: string } | undefined> {
  return runWithAuditContext({}, async () => {
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
      if (process.env.PLAYWRIGHT_TEST !== 'true') {
        const rateResult = guestRecommendationRateLimiter.check(ip, 60_000, 5)
        if (!rateResult.allowed) {
          return { error: t('rateLimit') }
        }
      }

      const turnstile = await verifyTurnstileToken(
        parsed.turnstileToken,
        ip,
        getRequestHost(headerStore),
      )
      if (!turnstile.success) {
        return { error: t('validation') }
      }

      const duplicates = await checkBrandDuplicates(parsed.name, parsed.website)
      // Both collisions are advisory once the visitor has ticked the inline "not
      // a duplicate" confirmation — the submission still lands in the moderation
      // queue, where a real duplicate gets rejected by a human.
      if (!parsed.duplicateConfirmed) {
        if (duplicates.nameMatches.length > 0) {
          return { error: tSubmit('fields.nameDuplicateTitle') }
        }
        if (duplicates.websiteMatches.length > 0) {
          return { error: tSubmit('fields.websiteDuplicateTitle') }
        }
      }

      await submitBrandForReview({
        intent: 'recommend',
        idempotencyKey,
        brandName: parsed.name,
        websiteUrl: parsed.website,
        description: parsed.description?.trim() || undefined,
        heroImageUrl: parsed.heroImageUrl || undefined,
        isBrandOwner: false,
        pdpaConsent: parsed.pdpaConsent,
        sourceAttribution: parsed.sourceAttribution,
        submitterEmail: parsed.guestEmail?.trim() || buildGuestSubmissionEmail(),
      }, { useServiceRole: true })

      if (parsed.marketingEmailOptIn && parsed.guestEmail?.trim()) {
        await enrollInMarketingEmails(createServiceClient(), {
          email: parsed.guestEmail,
          locale: await getLocale(),
          source: 'guest_recommendation',
          newsletter: true,
        })
      }

      return undefined
    } catch (err) {
      console.error('Submit recommendation error:', err)
      if (isDnsResolutionError(err)) {
        console.error('Submit recommendation DNS resolution failure:', err)
        return { error: t('unexpected') }
      }
      return { error: t('unexpected') }
    }
  });
}
