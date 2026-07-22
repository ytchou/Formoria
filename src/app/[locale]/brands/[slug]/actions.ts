'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod/v3'
import { requireClaimUser } from '@/lib/auth/claim-user'
import { getSiteUrl } from '@/lib/auth/site-url'
import { sendEmail } from '@/lib/email/send'
import { buildClaimEmailVerificationEmail } from '@/lib/email/templates'
import { createInMemoryRateLimiter } from '@/lib/security/rate-limiter'
import { getBrandById } from '@/lib/services/brands'
import {
  CLAIM_PROOF_TYPES,
  createClaimRequest,
  hasPendingClaim,
  type ProofEvidence,
} from '@/lib/services/claim-requests'
import { createReport } from '@/lib/services/reports'
import {
  createEvidence,
  type OriginEvidenceSourceType,
  type OriginEvidenceStance,
} from '@/lib/services/origin-evidence'
import { enrollInMarketingEmails } from '@/lib/services/marketing-email-consent'
import { createServiceClient } from '@/lib/supabase/server'
import { trackOriginEvidenceSubmitted } from '@/lib/analytics'

const REPORT_REASONS = [
  'incorrect_info',
  'broken_link',
  'inappropriate',
  'ownership_dispute',
  'removal_request',
] as const
type SubmitReportReason = (typeof REPORT_REASONS)[number]
const AUTHENTICATED_REPORT_REASONS: readonly SubmitReportReason[] = [
  'ownership_dispute',
  'removal_request',
]
type Translator = Awaited<ReturnType<typeof getTranslations<'brandDetail.claim.errors'>>>

export type ReportState = { error?: string; success?: boolean }

const EVIDENCE_STANCES = ['supports', 'contradicts'] as const
const EVIDENCE_SOURCE_TYPES = [
  'product_label',
  'packaging',
  'official_site',
  'in_store',
  'other',
] as const

export type EvidenceErrorCode =
  | 'not_logged_in'
  | 'missing_brand_id'
  | 'missing_brand_slug'
  | 'invalid_stance'
  | 'invalid_source_type'
  | 'notes_too_long'
  | 'invalid_photo_path'
  | 'pending_cap_reached'
  | 'database_error'
  | 'unknown'

export type EvidenceState = { error?: EvidenceErrorCode; success?: boolean }

export type SubmitClaimInput = {
  brandId: string
  proofs: ProofEvidence[]
  mitSmileCert?: string
  locale?: 'zh-TW' | 'en'
  marketingEmailOptIn?: boolean
}

export type SubmitClaimResult =
  | { ok: true; domainEmailVerificationSentTo?: string }
  | { error: string }

const reportRateLimiter = createInMemoryRateLimiter()

export async function getPendingClaimStatusAction(brandId: string): Promise<boolean> {
  const user = await requireClaimUser()
  return user ? hasPendingClaim(user.id, brandId) : false
}

function buildFieldSchemas(t: Translator) {
  const proofSchema = z
    .object({
      type: z.enum(CLAIM_PROOF_TYPES, {
        errorMap: () => ({ message: t('invalidProofType') }),
      }),
      url: z.string().trim().optional(),
      imageKey: z.string().trim().optional(),
      note: z.string().trim().optional(),
    })
    .superRefine((proof, ctx) => {
      if (proof.type === 'domain_email') {
        const emailResult = z.string().email().safeParse(proof.url)
        if (!emailResult.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['url'],
            message: t('invalidProofEmail'),
          })
        }
        return
      }

      if ((proof.type === 'backend_screenshot' || proof.type === 'business_doc') && !proof.imageKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['imageKey'],
          message: t('proofEvidenceRequired'),
        })
      }
    })

  return {
    brandId: z.string().trim().min(1, t('missingBrandId')),
    proofs: z.array(proofSchema).min(1, t('proofsMin')),
    mitSmileCert: z.string().trim().optional(),
    locale: z.enum(['zh-TW', 'en']).optional(),
    marketingEmailOptIn: z.boolean().optional().default(false),
  }
}

function getSubmitClaimSchema(t: Translator) {
  const fields = buildFieldSchemas(t)
  return z.object(fields)
}

export async function submitClaimAction(input: SubmitClaimInput): Promise<SubmitClaimResult> {
  const t = await getTranslations('brandDetail.claim.errors')
  try {
    const user = await requireClaimUser()
    if (!user) return { error: t('notLoggedIn') }

    const parsed = getSubmitClaimSchema(t).safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? t('unknown') }
    }

    const imageNamespace = `claim-proofs/${user.id}/`
    const invalidImageKey = parsed.data.proofs.find(
      (proof) => proof.imageKey && !proof.imageKey.startsWith(imageNamespace)
    )
    if (invalidImageKey) {
      return { error: t('invalidImageKey') }
    }

    const brand = await getBrandById(parsed.data.brandId)

    const claimRequest = await createClaimRequest({
      userId: user.id,
      brandId: parsed.data.brandId,
      proofEvidence: parsed.data.proofs,
      mitSmileCert: parsed.data.mitSmileCert || undefined,
    })

    const locale = parsed.data.locale ?? 'zh-TW'
    const siteUrl = getSiteUrl().replace(/\/$/, '')

    for (const verification of claimRequest.emailVerificationTokens) {
      const params = new URLSearchParams({
        cr: claimRequest.id,
        i: String(verification.proofIndex),
        token: verification.token,
        locale,
      })
      const verifyUrl = `${siteUrl}/api/claim/verify-email?${params.toString()}`

      if (process.env.NODE_ENV !== 'production') {
        console.log('[claim-email-verification]', verifyUrl)
      }

      await sendEmail(await buildClaimEmailVerificationEmail({
        recipientEmail: verification.email,
        brandName: brand.name,
        verifyUrl,
        siteUrl,
        locale,
      }))
    }

    if (parsed.data.marketingEmailOptIn && user.email) {
      await enrollInMarketingEmails(createServiceClient(), {
        email: user.email,
        userId: user.id,
        locale,
        source: 'brand_claim',
        newsletter: true,
        lifecycle: true,
      })
    }

    revalidatePath('/admin')
    revalidatePath('/admin/claims')
    return {
      ok: true,
      ...(claimRequest.emailVerificationTokens[0]
        ? { domainEmailVerificationSentTo: claimRequest.emailVerificationTokens[0].email }
        : {}),
    }
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

    const reasonRaw = formData.get('reason') as string | null
    if (!reasonRaw || !REPORT_REASONS.includes(reasonRaw as SubmitReportReason)) {
      return { error: t('invalidReason') }
    }
    const reason = reasonRaw as SubmitReportReason

    let userId: string | undefined
    if (AUTHENTICATED_REPORT_REASONS.includes(reason)) {
      const user = await requireClaimUser()
      if (!user) {
        const claimT = await getTranslations('brandDetail.claim.errors')
        return { error: claimT('notLoggedIn') }
      }
      userId = user.id
    }

    const notesRaw = formData.get('notes') as string | null
    const notes = notesRaw?.trim() || null
    if (notes && notes.length > 1000) {
      return { error: t('notesTooLong') }
    }

    const reportedFieldRaw = formData.get('reportedField')
    const reportedField = typeof reportedFieldRaw === 'string'
      ? reportedFieldRaw.trim() || undefined
      : undefined

    const h = await headers()
    const ip = h.get('cf-connecting-ip') ?? h.get('x-forwarded-for')?.split(',')[0].trim() ?? h.get('x-real-ip') ?? 'unknown'

    const rl = reportRateLimiter.check(`report:${ip}`, 60_000, 3)
    if (!rl.allowed) {
      return { error: t('rateLimited') }
    }

    await createReport({
      brandId,
      reason,
      notes,
      ...(reportedField ? { reportedField } : {}),
      ...(userId ? { userId } : {}),
    })
    revalidatePath('/admin/reports')
    revalidatePath('/admin')
    return { success: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : t('unknown')
    console.error('[brands:submitReport]', err)
    return { error: message }
  }
}

export async function submitEvidenceAction(
  _prevState: EvidenceState,
  formData: FormData,
): Promise<EvidenceState> {
  try {
    const user = await requireClaimUser()
    if (!user) return { error: 'not_logged_in' }

    const brandId = formData.get('brandId')
    if (typeof brandId !== 'string' || !brandId.trim()) {
      return { error: 'missing_brand_id' }
    }

    const brandSlug = formData.get('brandSlug')
    if (typeof brandSlug !== 'string' || !brandSlug.trim()) {
      return { error: 'missing_brand_slug' }
    }

    const stance = formData.get('stance')
    if (
      typeof stance !== 'string' ||
      !EVIDENCE_STANCES.includes(stance as OriginEvidenceStance)
    ) {
      return { error: 'invalid_stance' }
    }

    const sourceType = formData.get('sourceType')
    if (
      typeof sourceType !== 'string' ||
      !EVIDENCE_SOURCE_TYPES.includes(sourceType as OriginEvidenceSourceType)
    ) {
      return { error: 'invalid_source_type' }
    }

    const notesRaw = formData.get('notes')
    const notes = typeof notesRaw === 'string' ? notesRaw.trim() : ''
    if (notes.length > 1000) return { error: 'notes_too_long' }

    const productNameRaw = formData.get('productName')
    const productName = typeof productNameRaw === 'string'
      ? productNameRaw.trim() || null
      : null
    const photoPaths = formData
      .getAll('photoPaths')
      .filter((path): path is string => typeof path === 'string' && path.length > 0)
    const photoNamespace = `origin-evidence/${user.id}/${brandId.trim()}/`
    if (photoPaths.some((path) => !path.startsWith(photoNamespace))) {
      return { error: 'invalid_photo_path' }
    }

    const result = await createEvidence({
      userId: user.id,
      brandId: brandId.trim(),
      stance: stance as OriginEvidenceStance,
      productName,
      sourceType: sourceType as OriginEvidenceSourceType,
      notes,
      photoPaths,
    })
    if (!result.ok) return { error: result.code }

    trackOriginEvidenceSubmitted(brandId.trim(), brandSlug.trim(), stance)
    revalidatePath(`/brands/${brandSlug.trim()}`)
    revalidatePath('/admin/evidence')
    revalidatePath('/contributions')
    return { success: true }
  } catch (err: unknown) {
    console.error('[brands:submitEvidence]', err)
    return { error: 'unknown' }
  }
}
