'use server'

import { runWithAuditContext } from '@/lib/audit/context'
import { headers } from 'next/headers'
import { getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import {
  createRecommendationSubmissionSchema,
  type SubmissionFormData,
} from '@/lib/validations/submission'
import { submissionWizardSchema } from '@/lib/schemas/submission-wizard'
import { submitBrandForReview } from '@/lib/services/submission-pipeline'
import { cleanBrandName } from '@/lib/services/brand-cleanup'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyTurnstileToken } from '@/lib/security/turnstile'
import { createInMemoryRateLimiter } from '@/lib/security/rate-limiter'
import type { DuplicateCandidate, SourceAttribution } from '@/lib/types/submission'
import { isOwnerFeaturesEnabled } from '@/lib/services/app-settings'
import { getUserBrand } from '@/lib/services/brand-owners'
import {
  buildGuestSubmissionEmail,
  checkBrandDuplicates,
} from '@/lib/services/submissions'
import { enrollInMarketingEmails } from '@/lib/services/marketing-email-consent'

// Per-user in-action rate limiter for brand submissions (5 per 60s)
const ownerSubmissionRateLimiter = createInMemoryRateLimiter()
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

export async function submitOwnerQuick(
  data: unknown,
  idempotencyKey?: string | null,
): Promise<{ error?: string; ownershipAdjusted?: boolean } | undefined> {
  return runWithAuditContext({}, async () => {
    const t = await getTranslations('submit.errors')
    // Owner-features kill switch: refuse before auth so a stale client that still
    // holds the owner form cannot write while the surface is hidden.
    if (!(await isOwnerFeaturesEnabled())) return { error: t('unexpected') }

    try {
      const parsed = z.object({
        name: z.string().min(1),
        romanizedName: z
          .string()
          .min(2)
          .max(100)
          .regex(/^[a-zA-Z0-9\s\-'.]+$/)
          .optional()
          .or(z.literal('')),
        website: z.string().url(),
        description: z.string().min(1),
        pdpaConsent: z.literal(true),
        marketingEmailOptIn: z.boolean().default(false),
        turnstileToken: z.string().min(1),
        honeypot: z.string(),
      }).parse(data)

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

      if (process.env.PLAYWRIGHT_TEST !== 'true') {
        const rateResult = ownerSubmissionRateLimiter.check(user.id, 60_000, 5)
        if (!rateResult.allowed) {
          return { error: t('rateLimit') }
        }
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
        idempotencyKey,
        brandName: parsed.name,
        romanizedName: parsed.romanizedName?.trim() || undefined,
        websiteUrl: parsed.website,
        description: parsed.description,
        intent: ownershipAdjusted ? 'recommend' : 'owner_claim',
        isBrandOwner: !ownershipAdjusted,
        submitterEmail: user.email ?? '',
        submitterName: user.user_metadata?.full_name ?? undefined,
        pdpaConsent: true,
      })

      if (parsed.marketingEmailOptIn && user.email) {
        await enrollInMarketingEmails(createServiceClient(), {
          email: user.email,
          userId: user.id,
          locale: await getLocale(),
          source: 'owner_quick_submission',
          newsletter: true,
        })
      }

      return ownershipAdjusted ? { ownershipAdjusted: true } : undefined
    } catch (err) {
      console.error('Submit owner quick error:', err)
      if (isDnsResolutionError(err)) {
        console.error('Submit owner quick DNS resolution failure:', err)
        return { error: t('unexpected') }
      }
      return { error: t('unexpected') }
    }
  });
}

export async function submitOwnerDetailedBrand(
  data: unknown,
  idempotencyKey?: string | null,
): Promise<{ error?: string; ownershipAdjusted?: boolean } | undefined> {
  return runWithAuditContext({}, async () => {
    const t = await getTranslations('submit.errors')
    if (!(await isOwnerFeaturesEnabled())) return { error: t('unexpected') }

    try {
      const parsed = submissionWizardSchema.extend({
        pdpaConsent: z.literal(true),
        marketingEmailOptIn: z.boolean().default(false),
        turnstileToken: z.string().min(1),
        honeypot: z.string(),
      }).parse(data)

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

      if (process.env.PLAYWRIGHT_TEST !== 'true') {
        const rateResult = ownerSubmissionRateLimiter.check(user.id, 60_000, 5)
        if (!rateResult.allowed) {
          return { error: t('rateLimit') }
        }
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
      const ownerData = {
        categorySlug: parsed.categorySlug,
        foundingYear: parsed.foundingYear,
        subcategories: parsed.subcategories,
        city: parsed.city,
        productPhotos: parsed.productPhotos,
        mitStory: parsed.mitStory,
      }

      await submitBrandForReview({
        idempotencyKey,
        brandName: parsed.name,
        romanizedName: parsed.romanizedName?.trim() || undefined,
        websiteUrl: parsed.website,
        description: parsed.description,
        heroImageUrl: parsed.heroImageUrl,
        purchaseWebsite: parsed.purchaseWebsite?.trim() || undefined,
        intent: ownershipAdjusted ? 'recommend' : 'owner_claim',
        isBrandOwner: !ownershipAdjusted,
        socialLinks: {
          instagram: parsed.socialInstagram,
          threads: parsed.socialThreads,
          facebook: parsed.socialFacebook,
          pinkoi: parsed.purchasePinkoi,
          shopee: parsed.purchaseShopee,
          myship: parsed.purchaseMyship,
        },
        otherUrls: parsed.otherUrls?.flatMap(({ label, url }) => {
          const normalizedLabel = label?.trim()
          const normalizedUrl = url?.trim()

          return normalizedLabel && normalizedUrl
            ? [{ label: normalizedLabel, url: normalizedUrl }]
            : []
        }),
        ownerData,
        submitterEmail: user.email ?? '',
        submitterName: user.user_metadata?.full_name ?? undefined,
        pdpaConsent: true,
      })

      if (parsed.marketingEmailOptIn && user.email) {
        await enrollInMarketingEmails(createServiceClient(), {
          email: user.email,
          userId: user.id,
          locale: await getLocale(),
          source: 'owner_detailed_submission',
          newsletter: true,
        })
      }

      return ownershipAdjusted ? { ownershipAdjusted: true } : undefined
    } catch (err) {
      console.error('Submit owner detailed brand error:', err)
      if (isDnsResolutionError(err)) {
        console.error('Submit owner detailed brand DNS resolution failure:', err)
        return { error: t('unexpected') }
      }
      return { error: t('unexpected') }
    }
  });
}
