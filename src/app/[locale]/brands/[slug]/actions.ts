'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createInMemoryRateLimiter } from '@/lib/security/rate-limiter'
import { createClaimRequest } from '@/lib/services/claim-requests'
import { createReport, type ReportReason } from '@/lib/services/reports'

const REPORT_REASONS = ['not_mit', 'incorrect_info', 'broken_link', 'inappropriate'] as const
const CLAIM_PROOF_TYPES = ['domain_email', 'social_post', 'business_registration'] as const

export type ReportState = { error?: string; success?: boolean }

export type SubmitClaimInput = {
  brandId: string
  proofType: (typeof CLAIM_PROOF_TYPES)[number]
  proofUrl?: string
  proofNotes?: string
}

export type SubmitClaimResult = { ok: true } | { error: string }

const reportRateLimiter = createInMemoryRateLimiter()

async function requireClaimUser(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return { error: '請先登入後再提交認領申請 / Please sign in to submit a claim.' }
  }

  return { userId: user.id }
}

export async function submitClaimAction(input: SubmitClaimInput): Promise<SubmitClaimResult> {
  try {
    const auth = await requireClaimUser()
    if ('error' in auth) return auth

    const brandId = input.brandId.trim()
    if (!brandId) {
      return { error: '缺少品牌 ID / Missing brand ID.' }
    }

    if (!CLAIM_PROOF_TYPES.includes(input.proofType)) {
      return { error: '請選擇有效的認領證明類型 / Please choose a valid proof type.' }
    }

    const proofUrl = input.proofUrl?.trim()
    const proofNotes = input.proofNotes?.trim()

    await createClaimRequest({
      userId: auth.userId,
      brandId,
      proofType: input.proofType,
      proofUrl: proofUrl || undefined,
      proofNotes: proofNotes || undefined,
    })

    revalidatePath('/admin')
    return { ok: true }
  } catch (err) {
    console.error('[brands:submitClaim]', err)

    if ((err as { code?: string }).code === '23505') {
      return {
        error: '你已提交過這個品牌的認領申請 / You have already submitted a claim for this brand.',
      }
    }

    return {
      error: err instanceof Error ? err.message : '提交失敗，請稍後再試。 / Something went wrong. Please try again.',
    }
  }
}

export async function submitReportAction(prevState: ReportState, formData: FormData): Promise<ReportState> {
  try {
    const brandId = formData.get('brandId') as string | null
    if (!brandId) return { error: '缺少品牌 ID' }

    const reason = formData.get('reason') as string | null
    if (!reason || !REPORT_REASONS.includes(reason as ReportReason)) {
      return { error: '請選擇有效的檢舉原因' }
    }

    const notesRaw = formData.get('notes') as string | null
    const notes = notesRaw?.trim() || null
    if (notes && notes.length > 1000) {
      return { error: '補充說明不得超過 1000 字' }
    }

    const h = await headers()
    const ip = h.get('x-forwarded-for')?.split(',')[0].trim() ?? h.get('x-real-ip') ?? 'unknown'

    const rl = reportRateLimiter.check(`report:${ip}`, 60_000, 3)
    if (!rl.allowed) {
      return { error: '檢舉次數過多，請稍後再試。' }
    }

    await createReport({ brandId, reason: reason as ReportReason, notes })
    revalidatePath('/admin/reports')
    revalidatePath('/admin')
    return { success: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '發生未知錯誤'
    console.error('[brands:submitReport]', err)
    return { error: message }
  }
}
