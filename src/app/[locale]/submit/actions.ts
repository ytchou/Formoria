'use server'

import { getTranslations } from 'next-intl/server'
import { createSubmissionSchema, type SubmissionFormData } from '@/lib/validations/submission'
import { deriveCategoryFromProductType } from '@/lib/taxonomy/ontology'
import { scanContent } from '@/lib/services/moderation'
import { submitBrandForReview } from '@/lib/services/submission-pipeline'
import { checkBrandDuplicates } from '@/lib/services/submissions'
import { createClient } from '@/lib/supabase/server'
import { verifyTurnstileToken } from '@/lib/security/turnstile'
import { createInMemoryRateLimiter } from '@/lib/security/rate-limiter'
import type { DuplicateCheckResult, SourceAttribution } from '@/lib/types/submission'

// Per-user in-action rate limiter for brand submissions (5 per 60s)
const submissionRateLimiter = createInMemoryRateLimiter()

type SubmitBrandInput = SubmissionFormData & {
  isOwner?: boolean
  sourceAttribution?: SourceAttribution
}

export async function checkDuplicates(
  name: string,
  ubn?: string
): Promise<DuplicateCheckResult> {
  return checkBrandDuplicates(name, ubn)
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
    const derivedCategory = deriveCategoryFromProductType(
      parsed.productType ?? '',
      parsed.productTypeNote,
    )

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
    if (parsed._honeypot) {
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

    const moderationPayload = {
      fields: {
        name: parsed.name,
        description: parsed.description,
        website: parsed.socialLinks.website,
        purchaseUrl: parsed.purchaseLinks[0]?.url,
      },
      brandName: parsed.name,
    }
    const moderationResult = scanContent(moderationPayload)
    if (moderationResult.riskLevel === 'high') {
      return { error: t('validation') }
    }

    await submitBrandForReview({
      name: parsed.name,
      slug: '',
      description: parsed.description,
      heroImageUrl: parsed.heroImageUrl ?? null,
      category: derivedCategory,
      purchaseLinks: parsed.purchaseLinks.map((l) => ({
        ...l,
        label: l.platform,
      })),
      socialLinks: {
        instagram: parsed.socialLinks.instagram || undefined,
        threads: parsed.socialLinks.threads || undefined,
        facebook: parsed.socialLinks.facebook || undefined,
        officialWebsite: parsed.socialLinks.website || undefined,
      },
      retailLocations: parsed.retailLocations.map((loc) => ({
        ...loc,
        latitude: 0,
        longitude: 0,
      })),
      productPhotos: parsed.productPhotos,
      contactEmail: user.email ?? null,
      brandHighlights: null,
      unifiedBusinessNumber: parsed.unifiedBusinessNumber ?? null,
      submitterEmail: user.email ?? '',
      submitterName: user.user_metadata?.full_name ?? null,
      isBrandOwner: isOwner,
      sourceAttribution: data.sourceAttribution ?? null,
      pdpaConsentAt: new Date().toISOString(),
      region: parsed.region,
      valueTags: parsed.valueTags,
      productType: parsed.productType,
      productTypeNote: parsed.productTypeNote ?? null,
      moderationFlags: moderationResult.flags,
      moderatorUserId: user.id,
      onModerationFlagsError: (err: unknown) => {
        console.error('Save moderation flags error:', err)
      },
    } as unknown as Parameters<typeof submitBrandForReview>[0])

    return undefined // Success — no error
  } catch (err) {
    console.error('Submit brand error:', err)
    return {
      error:
        err instanceof Error
          ? err.message
          : t('unexpected'),
    }
  }
}
