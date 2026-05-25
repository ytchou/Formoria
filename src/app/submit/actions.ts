'use server'

import { createSubmissionSchema, type SubmissionFormData } from '@/lib/validations/submission'
import { createBrand } from '@/lib/services/brands'
import { createSubmission } from '@/lib/services/submissions'
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

export async function submitBrand(
  data: SubmitBrandInput
): Promise<{ error: string } | undefined> {
  try {
    // Server-side validation — schema switches based on isOwner flag
    const isOwner = data.isOwner ?? false
    const schema = createSubmissionSchema(isOwner)
    const parsed = schema.parse(data)

    // Get authenticated user
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { error: '請先登入才能提交品牌' }
    }

    // Honeypot check — silently succeed (don't reveal the trap to bots)
    if (parsed._honeypot) {
      return undefined
    }

    // Rate limit check per user
    const rateResult = submissionRateLimiter.check(user.id, 60_000, 5)
    if (!rateResult.allowed) {
      return { error: '提交次數過多，請稍後再試。' }
    }

    // Turnstile verification
    const turnstile = await verifyTurnstileToken(parsed.turnstileToken)
    if (!turnstile.success) {
      return { error: '驗證失敗，請再試一次。' }
    }

    // Create brand with pending status
    const brand = await createBrand({
      name: parsed.name,
      slug: '',
      description: parsed.description,
      logoUrl: parsed.logoUrl ?? null,
      heroImageUrl: null,
      status: 'pending',
      isVerified: false,
      category: parsed.category,
      foundingYear: null,
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
      founder: parsed.founderName?.trim()
        ? {
            name: parsed.founderName.trim(),
            title: parsed.founderTitle?.trim() || null,
            avatarUrl: null,
            quote: parsed.founderBio?.trim() || null,
          }
        : null,
      brandHighlights: parsed.brandHighlights?.trim() || null,
    })

    // Create submission audit record
    await createSubmission({
      brandId: brand.id,
      brandName: parsed.name,
      submitterEmail: user.email ?? '',
      submitterName: user.user_metadata?.full_name ?? null,
      description: parsed.description,
      websiteUrl: parsed.socialLinks.website || null,
      socialLinks: {
        instagram: parsed.socialLinks.instagram || undefined,
        threads: parsed.socialLinks.threads || undefined,
        facebook: parsed.socialLinks.facebook || undefined,
        officialWebsite: parsed.socialLinks.website || undefined,
      },
      suggestedTags: parsed.tags,
      pdpaConsentAt: new Date().toISOString(),
      isBrandOwner: isOwner,
      sourceAttribution: data.sourceAttribution ?? undefined,
    })

    return undefined // Success — no error
  } catch (err) {
    console.error('Submit brand error:', err)
    return {
      error:
        err instanceof Error
          ? err.message
          : '發生預期外的錯誤，請再試一次。',
    }
  }
}
