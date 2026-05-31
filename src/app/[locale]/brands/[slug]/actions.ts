'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createInMemoryRateLimiter } from '@/lib/security/rate-limiter'
import { createReport, type ReportReason } from '@/lib/services/reports'

const REPORT_REASONS = ['not_mit', 'incorrect_info', 'broken_link', 'inappropriate'] as const

export type ReportState = { error?: string; success?: boolean }

const reportRateLimiter = createInMemoryRateLimiter()

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
