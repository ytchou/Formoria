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
  type ProofEvidence,
} from '@/lib/services/claim-requests'
import { createReport } from '@/lib/services/reports'

const REPORT_REASONS = ['not_mit', 'incorrect_info', 'broken_link', 'inappropriate'] as const
type SubmitReportReason = (typeof REPORT_REASONS)[number]
type Translator = Awaited<ReturnType<typeof getTranslations<'brandDetail.claim.errors'>>>

export type ReportState = { error?: string; success?: boolean }

export type SubmitClaimInput = {
  brandId: string
  proofs: ProofEvidence[]
  mitSmileCert?: string
  locale?: 'zh-TW' | 'en'
}

export type SubmitClaimResult =
  | { ok: true; domainEmailVerificationSentTo?: string }
  | { error: string }

const reportRateLimiter = createInMemoryRateLimiter()

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

      sendEmail(buildClaimEmailVerificationEmail({
        recipientEmail: verification.email,
        brandName: brand.name,
        verifyUrl,
        siteUrl,
        locale,
      }))
    }

    revalidatePath('/admin')
    revalidatePath('/admin/claim-requests')
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
    const reasons = reasonRaw?.split(',').filter(Boolean) ?? []
    if (reasons.length === 0 || reasons.some((r) => !REPORT_REASONS.includes(r as SubmitReportReason))) {
      return { error: t('invalidReason') }
    }
    const reason = reasons.join(',')


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
