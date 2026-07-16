import type { Database } from '@/lib/supabase/database.types'

import { buildReviewUpdate, type ReviewStatus, type ReviewDecision } from './review-status'

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

type ReportRow = Database['public']['Tables']['brand_reports']['Row']

/** Shape returned by: brand_reports.select('*, brands(name, slug)') */
type ReportRowWithBrand = ReportRow & {
  brands: { name: string; slug: string } | null
}

export type ReportReason =
  | 'not_mit'
  | 'incorrect_info'
  | 'broken_link'
  | 'inappropriate'
  | 'ownership_dispute'

type ReportStatus = ReviewStatus

export type BrandReport = {
  id: string
  brandId: string
  brandName: string | null
  brandSlug: string | null
  reason: ReportReason
  notes: string | null
  status: ReportStatus
  reviewedAt: string | null
  createdAt: string
  reporterEmail?: string
  brandHasOwner?: boolean
}

type DisputeRow = {
  reason: string
  user_id: string | null
  brand_id: string
}

type DisputeRowEnrichment = {
  reporterEmail?: string
  brandHasOwner?: boolean
}

export async function enrichDisputeRows<T extends DisputeRow>(
  rows: T[],
  deps: {
    getEmail: (userId: string) => Promise<string | null>
    getOwnedBrandIds: () => Promise<Set<string>>
  }
): Promise<Array<T & DisputeRowEnrichment>> {
  const disputeRows = rows.filter((row) => row.reason === 'ownership_dispute')
  if (disputeRows.length === 0) return rows

  const userIds = [
    ...new Set(disputeRows.flatMap((row) => row.user_id ? [row.user_id] : [])),
  ]
  const [ownedBrandIds, emailEntries] = await Promise.all([
    deps.getOwnedBrandIds(),
    Promise.all(userIds.map(async (userId) => [userId, await deps.getEmail(userId)] as const)),
  ])
  const emailByUserId = new Map(emailEntries)

  return rows.map((row) => {
    if (row.reason !== 'ownership_dispute') return row

    const reporterEmail = row.user_id ? emailByUserId.get(row.user_id) : null
    return {
      ...row,
      ...(reporterEmail ? { reporterEmail } : {}),
      brandHasOwner: ownedBrandIds.has(row.brand_id),
    }
  })
}

export function buildReportRecord(input: {
  brandId: string
  reason: ReportReason
  notes?: string | null
  userId?: string
}): { brand_id: string; reason: ReportReason; notes: string | null; user_id: string | null } {
  return {
    brand_id: input.brandId,
    reason: input.reason,
    notes: input.notes ?? null,
    user_id: input.userId ?? null,
  }
}

export async function createReport(input: {
  brandId: string
  reason: ReportReason
  notes?: string | null
  userId?: string
}): Promise<void> {
  const { createServiceClient } = await import('@/lib/supabase/server')
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('brand_reports')
    .insert(buildReportRecord(input))

  if (error) throw error
}

export async function getPendingReports(options?: { limit?: number }): Promise<BrandReport[]> {
  const { createServiceClient } = await import('@/lib/supabase/server')
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
  const enrichedRows = await enrichDisputeRows(rows, {
    getEmail: async (userId) => {
      const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId)
      if (userError) throw userError
      return userData.user.email ?? null
    },
    getOwnedBrandIds: async () => {
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
    reason: row.reason as ReportReason,
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
  decision: ReviewDecision
): Promise<void> {
  const { createServiceClient } = await import('@/lib/supabase/server')
  const supabase = createServiceClient()

  const updateData = buildReviewUpdate(decision)

  const { error } = await supabase
    .from('brand_reports')
    .update(updateData)
    .eq('id', reportId)

  if (error) throw error
}
