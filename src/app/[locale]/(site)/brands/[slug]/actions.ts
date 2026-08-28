'use server'

import { runWithAuditContext } from '@/lib/audit/context'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { requireCurrentUser } from '@/lib/auth/current-user'
import { createInMemoryRateLimiter } from '@/lib/security/rate-limiter'
import { createReport } from '@/lib/services/reports'
import { submitStockist } from '@/lib/services/stockists'
import { routes } from '@/lib/routes'

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
export type ReportState = { error?: string; success?: boolean }


export type StockistFormState = { error?: string; success?: true }

const reportRateLimiter = createInMemoryRateLimiter()

function getFormString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

export async function submitStockistInfoAction(
  _prevState: StockistFormState,
  formData: FormData,
): Promise<StockistFormState> {
  return runWithAuditContext({}, async () => {
    const t = await getTranslations('brandDetail.channels.errors')

    try {
      const user = await requireCurrentUser()
      if (!user) return { error: 'not_logged_in' }

      const brandId = getFormString(formData, 'brandId')
      if (!brandId) return { error: t('missing_brand_id') }

      const brandSlug = getFormString(formData, 'brandSlug')
      if (!brandSlug) return { error: t('missing_brand_slug') }

      const region = getFormString(formData, 'region')
      const result = await submitStockist(user.id, brandId, {
        name: getFormString(formData, 'name'),
        region,
        address: getFormString(formData, 'address'),
        url: getFormString(formData, 'url'),
      })
      if (!result.ok) return { error: t(result.code) }

      // Deliberately NOT revalidated. The submitted row is invisible until an
      // admin approves it, so no cached page renders anything different — and
      // `revalidatePublicBrands` purges the `public-brand-data` tag for all 718
      // brand pages plus a dozen paths, which any signed-in reader could then
      // trigger 20 times a day for zero rendered change. `reviewStockistAction`
      // fires exactly that revalidation at the moment the row becomes public.
      return { success: true }
    } catch (error) {
      console.error('[brands:submitStockistInfo]', error)
      return { error: t('unknown') }
    }
  })
}

export async function submitReportAction(
  _prevState: ReportState,
  formData: FormData,
): Promise<ReportState> {
  return runWithAuditContext({}, async () => {
    const t = await getTranslations('brandDetail.report.errors')
    try {
      const brandId = formData.get('brandId') as string | null
      if (!brandId) return { error: t('missingBrandId') }

      const reasonRaw = formData.get('reason') as string | null
      if (
        !reasonRaw ||
        !REPORT_REASONS.includes(reasonRaw as SubmitReportReason)
      ) {
        return { error: t('invalidReason') }
      }
      const reason = reasonRaw as SubmitReportReason

      let userId: string | undefined
      if (AUTHENTICATED_REPORT_REASONS.includes(reason)) {
        const user = await requireCurrentUser()
        if (!user) return { error: t('notLoggedIn') }
        userId = user.id
      }

      const notesRaw = formData.get('notes') as string | null
      const notes = notesRaw?.trim() || null
      if (notes && notes.length > 1000) {
        return { error: t('notesTooLong') }
      }

      const reportedFieldRaw = formData.get('reportedField')
      const reportedField =
        typeof reportedFieldRaw === 'string'
          ? reportedFieldRaw.trim() || undefined
          : undefined

      const h = await headers()
      const ip =
        h.get('cf-connecting-ip') ??
        h.get('x-forwarded-for')?.split(',')[0].trim() ??
        h.get('x-real-ip') ??
        'unknown'

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
      revalidatePath(routes.admin.reports())
      revalidatePath(routes.admin.index())
      return { success: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('unknown')
      console.error('[brands:submitReport]', err)
      return { error: message }
    }
  })
}
