export type ReportReason = 'not_mit' | 'incorrect_info' | 'broken_link' | 'inappropriate'

export type ReportStatus = 'pending' | 'reviewed' | 'dismissed'

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
}

export function buildReportRecord(input: {
  brandId: string
  reason: ReportReason
  notes?: string | null
}): { brand_id: string; reason: ReportReason; notes: string | null } {
  return {
    brand_id: input.brandId,
    reason: input.reason,
    notes: input.notes ?? null,
  }
}

export async function createReport(input: {
  brandId: string
  reason: ReportReason
  notes?: string | null
}): Promise<void> {
  const { createServiceClient } = await import('@/lib/supabase/server')
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('brand_reports')
    .insert(buildReportRecord(input))

  if (error) throw error
}

export async function getPendingReports(): Promise<BrandReport[]> {
  const { createServiceClient } = await import('@/lib/supabase/server')
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('brand_reports')
    .select('*, brands(name, slug)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (error) throw error

  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data ?? []).map((row: any) => ({
    id: row.id,
    brandId: row.brand_id,
    brandName: row.brands?.name ?? null,
    brandSlug: row.brands?.slug ?? null,
    reason: row.reason,
    notes: row.notes ?? null,
    status: row.status,
    reviewedAt: row.reviewed_at ?? null,
    createdAt: row.created_at,
  }))
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export async function updateReportStatus(
  reportId: string,
  decision: 'reviewed' | 'dismissed'
): Promise<void> {
  const { createServiceClient } = await import('@/lib/supabase/server')
  const supabase = createServiceClient()

  const updateData: Record<string, unknown> = {
    status: decision,
  }
  if (decision === 'reviewed') {
    updateData.reviewed_at = new Date().toISOString()
  }

  const { error } = await supabase
    .from('brand_reports')
    .update(updateData)
    .eq('id', reportId)

  if (error) throw error
}
