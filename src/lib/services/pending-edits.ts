import type { Brand, PendingBrandEdit, PendingBrandEditWithBrand } from '@/lib/types/brand'
import type { Database } from '@/lib/supabase/database.types'
import { NotFoundError } from '@/lib/errors'
import * as supabaseServer from '@/lib/supabase/server'
import { updateBrand } from './brands'

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

type PendingBrandEditRow = Database['public']['Tables']['pending_brand_edits']['Row']
type PendingBrandEditStatus = PendingBrandEdit['status']

type PendingBrandEditRowInput = Pick<PendingBrandEditRow, 'id'> &
  Partial<Omit<PendingBrandEditRow, 'id'>>

type PendingBrandEditWithBrandRowInput = PendingBrandEditRowInput & {
  brands?: {
    id?: string
    name?: string
    slug?: string
  } | null
}

type PendingEditSupabaseClient = Awaited<ReturnType<typeof supabaseServer.createClient>>
type SupabaseServerModule = typeof supabaseServer & {
  createServerClient?: () => PendingEditSupabaseClient | Promise<PendingEditSupabaseClient>
}

async function createServerClient(): Promise<PendingEditSupabaseClient> {
  const serverModule = supabaseServer as SupabaseServerModule
  const createClient = serverModule.createServerClient ?? serverModule.createClient
  return createClient()
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

export function pendingEditToDomain(row: PendingBrandEditRowInput): PendingBrandEdit {
  return {
    id: row.id,
    brandId: row.brand_id ?? '',
    submittedBy: row.submitted_by ?? '',
    proposedData: (row.proposed_data as Record<string, unknown>) ?? {},
    status: (row.status as PendingBrandEditStatus) ?? 'pending',
    reviewerNotes: row.reviewer_notes ?? null,
    reviewedAt: row.reviewed_at ?? null,
    reviewedBy: row.reviewed_by ?? null,
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? '',
  }
}

export function pendingEditWithBrandToDomain(
  row: PendingBrandEditWithBrandRowInput
): PendingBrandEditWithBrand {
  const edit = pendingEditToDomain(row)
  return {
    ...edit,
    brand: {
      id: row.brands?.id ?? edit.brandId,
      name: row.brands?.name ?? '',
      slug: row.brands?.slug ?? '',
    },
  }
}

function pendingEditToUpsert(
  brandId: string,
  submittedBy: string,
  proposedData: Record<string, unknown>
): Record<string, unknown> {
  return {
    brand_id: brandId,
    submitted_by: submittedBy,
    proposed_data: proposedData,
    status: 'pending',
    reviewer_notes: null,
    reviewed_at: null,
    reviewed_by: null,
  }
}

function isNoRowsError(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST116'
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function createPendingEdit(
  brandId: string,
  userId: string,
  proposedData: Record<string, unknown>
): Promise<PendingBrandEdit> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('pending_brand_edits')
    .upsert(pendingEditToUpsert(brandId, userId, proposedData), {
      onConflict: 'brand_id',
      ignoreDuplicates: false,
    })
    .select('*')
    .single()

  if (error) throw error
  return pendingEditToDomain(data)
}

export async function getPendingEdits(
  status?: PendingBrandEditStatus
): Promise<PendingBrandEditWithBrand[]> {
  const supabase = await createServerClient()
  let query = supabase.from('pending_brand_edits').select('*, brands(id,name,slug)')

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error } = await query.order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map(pendingEditWithBrandToDomain)
}

export async function getPendingEdit(brandId: string): Promise<PendingBrandEdit | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('pending_brand_edits')
    .select('*')
    .eq('brand_id', brandId)
    .eq('status', 'pending')
    .single()

  if (isNoRowsError(error)) return null
  if (error) throw error
  return data ? pendingEditToDomain(data) : null
}

export async function getPendingEditCount(): Promise<number> {
  const supabase = await createServerClient()
  const { count, error } = await supabase
    .from('pending_brand_edits')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')

  if (error) throw error
  return count ?? 0
}

export async function approvePendingEdit(id: string, reviewerId: string): Promise<void> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('pending_brand_edits')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) throw new NotFoundError('PendingBrandEdit', id)

  await updateBrand(data.brand_id, data.proposed_data as Partial<Brand>)

  const { error: updateError } = await supabase
    .from('pending_brand_edits')
    .update({
      status: 'approved',
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerId,
    })
    .eq('id', id)

  if (updateError) throw updateError
}

export async function rejectPendingEdit(
  id: string,
  reviewerId: string,
  notes?: string
): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('pending_brand_edits')
    .update({
      status: 'rejected',
      reviewer_notes: notes ?? null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerId,
    })
    .eq('id', id)

  if (error) throw error
}

export async function hasPendingEdit(brandId: string): Promise<boolean> {
  try {
    const pendingEdit = await getPendingEdit(brandId)
    return pendingEdit !== null
  } catch (error) {
    if (isNoRowsError(error as { code?: string })) return false
    throw error
  }
}

export async function getLatestEditReview(
  brandId: string,
  submittedBy: string
): Promise<PendingBrandEdit | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('pending_brand_edits')
    .select('*')
    .eq('brand_id', brandId)
    .eq('submitted_by', submittedBy)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (isNoRowsError(error)) return null
  if (error) throw error
  return data ? pendingEditToDomain(data) : null
}
