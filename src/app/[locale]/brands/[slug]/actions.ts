'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { createInMemoryRateLimiter } from '@/lib/security/rate-limiter'
import { createClaimRequest } from '@/lib/services/claim-requests'
import { createReport } from '@/lib/services/reports'

const REPORT_REASONS = ['not_mit', 'incorrect_info', 'broken_link', 'inappropriate'] as const
const CLAIM_PROOF_TYPES = ['domain_email', 'social_post', 'business_registration'] as const
type SubmitReportReason = (typeof REPORT_REASONS)[number]

export type ReportState = { error?: string; success?: boolean }

export type SubmitClaimInput = {
  brandId: string
  proofType: (typeof CLAIM_PROOF_TYPES)[number]
  proofUrl?: string
  proofNotes?: string
  mitSmileCert?: string
}

export type SubmitClaimResult = { ok: true } | { error: string }

const reportRateLimiter = createInMemoryRateLimiter()

async function requireClaimUser(t: Awaited<ReturnType<typeof getTranslations<'brandDetail.claim.errors'>>>): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return { error: t('notLoggedIn') }
  }

  return { userId: user.id }
}

export async function submitClaimAction(input: SubmitClaimInput): Promise<SubmitClaimResult> {
  const t = await getTranslations('brandDetail.claim.errors')
  try {
    const auth = await requireClaimUser(t)
    if ('error' in auth) return auth

    const brandId = input.brandId.trim()
    if (!brandId) {
      return { error: t('missingBrandId') }
    }

    if (!CLAIM_PROOF_TYPES.includes(input.proofType)) {
      return { error: t('invalidProofType') }
    }

    const proofUrl = input.proofUrl?.trim()
    const proofNotes = input.proofNotes?.trim()
    const mitSmileCert = input.mitSmileCert?.trim()

    await createClaimRequest({
      userId: auth.userId,
      brandId,
      proofType: input.proofType,
      proofUrl: proofUrl || undefined,
      proofNotes: proofNotes || undefined,
      mitSmileCert: mitSmileCert || null,
    })

    revalidatePath('/admin')
    revalidatePath('/admin/claim-requests')
    return { ok: true }
  } catch (err) {
    console.error('[brands:submitClaim]', err)

    if ((err as { code?: string }).code === '23505') {
      return { error: t('duplicate') }
    }

    return {
      error: err instanceof Error ? err.message : t('unknown'),
    }
  }
}

export async function submitReportAction(_prevState: ReportState, formData: FormData): Promise<ReportState> {
  const t = await getTranslations('brandDetail.report.errors')
  try {
    const brandId = formData.get('brandId') as string | null
    if (!brandId) return { error: t('missingBrandId') }

    const reason = formData.get('reason') as string | null
    if (!reason || !REPORT_REASONS.includes(reason as SubmitReportReason)) {
      return { error: t('invalidReason') }
    }

    const notesRaw = formData.get('notes') as string | null
    const notes = notesRaw?.trim() || null
    if (notes && notes.length > 1000) {
      return { error: t('notesTooLong') }
    }

    const h = await headers()
    const ip = h.get('x-forwarded-for')?.split(',')[0].trim() ?? h.get('x-real-ip') ?? 'unknown'

    const rl = reportRateLimiter.check(`report:${ip}`, 60_000, 3)
    if (!rl.allowed) {
      return { error: t('rateLimited') }
    }

    await createReport({ brandId, reason: reason as SubmitReportReason, notes })
    revalidatePath('/admin/reports')
    revalidatePath('/admin')
    return { success: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : t('unknown')
    console.error('[brands:submitReport]', err)
    return { error: message }
  }
}
