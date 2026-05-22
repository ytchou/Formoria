'use server'

import { fullSubmissionSchema, type SubmissionFormData } from '@/lib/validations/submission'
import { createBrand } from '@/lib/services/brands'
import { createSubmission } from '@/lib/services/submissions'
import { createClient } from '@/lib/supabase/server'
import { verifyTurnstileToken } from '@/lib/security/turnstile'
import { createInMemoryRateLimiter } from '@/lib/security/rate-limiter'

// Per-user in-action rate limiter for brand submissions (5 per 60s)
const submissionRateLimiter = createInMemoryRateLimiter()

export async function submitBrand(
  data: SubmissionFormData
): Promise<{ error: string } | undefined> {
  try {
    // Server-side validation
    const parsed = fullSubmissionSchema.parse(data)

    // Get authenticated user
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { error: 'You must be logged in to submit a brand' }
    }

    // Honeypot check — silently succeed (don't reveal the trap to bots)
    if (parsed._honeypot) {
      return undefined
    }

    // Rate limit check per user
    const rateResult = submissionRateLimiter.check(user.id, 60_000, 5)
    if (!rateResult.allowed) {
      return { error: 'Too many submissions. Please try again later.' }
    }

    // Turnstile verification
    const turnstile = await verifyTurnstileToken(parsed.turnstileToken)
    if (!turnstile.success) {
      return { error: 'Verification failed. Please try again.' }
    }

    // Create brand with pending status
    await createBrand({
      name: parsed.name,
      slug: '',
      description: parsed.description,
      logoUrl: parsed.logoUrl,
      heroImageUrl: null,
      status: 'pending',
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
      founder: null,
      productHighlights: [],
    })

    // Create submission audit record
    await createSubmission({
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
    })

    return undefined // Success — no error
  } catch (err) {
    console.error('Submit brand error:', err)
    return {
      error:
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred. Please try again.',
    }
  }
}
