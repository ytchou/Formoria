import type { Database } from '@/lib/supabase/database.types'
import { auditedCall } from '@/lib/audit'

import {
  buildReviewUpdate,
  type ReviewStatus,
  type ReviewDecision,
  type ReviewAttribution,
} from './review-status'

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

type ReportRow = Database['public']['Tables']['brand_reports']['Row']

/** Shape returned by: brand_reports.select('*, brands(name, slug)') */
type ReportRowWithBrand = ReportRow & {
  brands: { name: string; slug: string } | null
}

export type ReportReason =
  | 'incorrect_info'
  | 'broken_link'
  | 'inappropriate'
  | 'ownership_dispute'
  | 'removal_request'

type HistoricalReportReason = ReportReason | 'not_mit'

type ReportStatus = ReviewStatus

export type UpdateReportStatusResult =
  | { ok: true }
  | { ok: false; code: 'already_reviewed' | 'database_error' }

/**
 * Injectable claim seam. Mirrors `updateModerationFlagStatus` in `./moderation`:
 * the claim returns the claimed ROW, not a count. A `count` of `null` from
 * PostgREST means "no count was returned", which is indistinguishable from "no
 * pending row matched" — that ambiguity reported successful decisions to the
 * admin as review conflicts.
 */
export type UpdateReportStatusDeps = {
  claim: (
    reportId: string,
    update: Record<string, unknown>,
  ) => Promise<{ data: { id: string } | null; error: unknown }>
}

export type BrandReport = {
  id: string
  brandId: string
  brandName: string | null
  brandSlug: string | null
  reason: HistoricalReportReason
  notes: string | null
  status: ReportStatus
  reviewedAt: string | null
  createdAt: string
  reporterEmail?: string
  brandHasOwner?: boolean
}

export const defaultUpdateReportStatusDeps: UpdateReportStatusDeps = {
  async claim(reportId, update) {
    const { createServiceClient } = await import('@/lib/supabase/service')
    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('brand_reports')
      .update(update)
      .eq('id', reportId)
      // The pending guard makes this write idempotent and lets callers report a
      // review conflict instead of silently re-deciding a settled report.
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()

    return { data, error }
  },
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

type ReportRowWithReporter = {
  reason: string
  user_id: string | null
  brand_id: string
}

type ReporterRowEnrichment = {
  reporterEmail?: string
  brandHasOwner?: boolean
}

export async function enrichReporterRows<T extends ReportRowWithReporter>(
  rows: T[],
  deps: {
    getEmail: (userId: string) => Promise<string | null>
    getOwnedBrandIds: () => Promise<Set<string>>
  }
): Promise<Array<T & ReporterRowEnrichment>> {
  const reporterRows = rows.filter((row) =>
    row.reason === 'ownership_dispute' || row.reason === 'removal_request'
  )
  if (reporterRows.length === 0) return rows

  const userIds = [
    ...new Set(reporterRows.flatMap((row) => row.user_id ? [row.user_id] : [])),
  ]
  const [ownedBrandIds, emailEntries] = await Promise.all([
    deps.getOwnedBrandIds(),
    Promise.all(userIds.map(async (userId) => [userId, await deps.getEmail(userId)] as const)),
  ])
  const emailByUserId = new Map(emailEntries)

  return rows.map((row) => {
    if (row.reason !== 'ownership_dispute' && row.reason !== 'removal_request') return row

    const reporterEmail = row.user_id ? emailByUserId.get(row.user_id) : null
    return {
      ...row,
      ...(reporterEmail ? { reporterEmail } : {}),
      ...(row.reason === 'ownership_dispute'
        ? { brandHasOwner: ownedBrandIds.has(row.brand_id) }
        : {}),
    }
  })
}

export function buildReportRecord(input: {
  brandId: string
  reason: ReportReason
  notes?: string | null
  reportedField?: string | null
  userId?: string
}): {
  brand_id: string
  reason: ReportReason
  notes: string | null
  reported_field: string | null
  user_id: string | null
} {
  return {
    brand_id: input.brandId,
    reason: input.reason,
    notes: input.notes ?? null,
    reported_field: input.reportedField ?? null,
    user_id: input.userId ?? null,
  }
}

export async function createReport(input: {
  brandId: string
  reason: ReportReason
  notes?: string | null
  reportedField?: string | null
  userId?: string
}): Promise<void> {
  return auditedCall(
    { provider: 'brands', operation: 'createReport', kind: 'service' },
    async () => {
  const { createServiceClient } = await import('@/lib/supabase/service')
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('brand_reports')
    .insert(buildReportRecord(input))

  if (error) throw error
    },
  )
}

export async function getPendingReports(options?: { limit?: number }): Promise<BrandReport[]> {
  const { createServiceClient } = await import('@/lib/supabase/service')
  const supabase = createServiceClient()

  let query = supabase
    .from('brand_reports')
    .select('*, brands(name, slug)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (options?.limit) {
    query = query.limit(options.limit)
  }

  const { data, error } = await query

  if (error) throw error

  // Cast to typed join shape — Supabase's select return type doesn't track the brands join
  const rows = (data ?? []) as unknown as ReportRowWithBrand[]
  const disputeBrandIds = [
    ...new Set(
      rows
        .filter((row) => row.reason === 'ownership_dispute')
        .map((row) => row.brand_id)
    ),
  ]
  const enrichedRows = await enrichReporterRows(rows, {
    getEmail: async (userId) => {
      const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId)
      if (userError) throw userError
      return userData.user.email ?? null
    },
    getOwnedBrandIds: async () => {
      if (disputeBrandIds.length === 0) return new Set()

      const { data: ownershipRows, error: ownershipError } = await supabase
        .from('brand_owners')
        .select('brand_id')
        .in('brand_id', disputeBrandIds)

      if (ownershipError) throw ownershipError
      return new Set((ownershipRows ?? []).map((row) => row.brand_id))
    },
  })

  return enrichedRows.map((row) => ({
    id: row.id,
    brandId: row.brand_id,
    brandName: row.brands?.name ?? null,
    brandSlug: row.brands?.slug ?? null,
    reason: row.reason as HistoricalReportReason,
    notes: row.notes ?? null,
    status: row.status as ReportStatus,
    reviewedAt: row.reviewed_at ?? null,
    createdAt: row.created_at,
    ...(row.reporterEmail ? { reporterEmail: row.reporterEmail } : {}),
    ...(row.brandHasOwner !== undefined ? { brandHasOwner: row.brandHasOwner } : {}),
  }))
}

export async function updateReportStatus(
  reportId: string,
  decision: ReviewDecision,
  attribution?: ReviewAttribution,
  deps: UpdateReportStatusDeps = defaultUpdateReportStatusDeps,
): Promise<UpdateReportStatusResult> {
  return auditedCall<UpdateReportStatusResult>(
    { provider: 'brands', operation: 'updateReportStatus', kind: 'service' },
    async (ctx) => {
      const updateData = buildReviewUpdate(decision, attribution)

      try {
        const { data, error } = await deps.claim(reportId, updateData)

        if (error) {
          // The envelope only sees the returned value, so the underlying error
          // has to be carried out by hand or it is lost entirely.
          console.error('[reports] updateReportStatus claim failed:', error)
          ctx.summary.claimError = describeError(error)
          return { ok: false, code: 'database_error' }
        }
        // A returned row is the only proof the pending guard matched. No row
        // means the report was already decided — a genuine conflict.
        if (!data) {
          return { ok: false, code: 'already_reviewed' }
        }
        return { ok: true }
      } catch (error) {
        console.error('[reports] updateReportStatus threw:', error)
        ctx.summary.claimError = describeError(error)
        return { ok: false, code: 'database_error' }
      }
    },
    {
      // Without this the swallowed failure above is audited as `succeeded` with
      // normal latency, and nothing about the failed write reaches the trail.
      // `already_reviewed` is not a fault — it is an honest "no pending row
      // claimed" — so it maps to `empty` rather than `failed`.
      classify: (result) => {
        if (result.ok) return 'succeeded'
        return result.code === 'already_reviewed' ? 'empty' : 'failed'
      },
    },
  )
}
