import type { Database } from '@/lib/supabase/database.types'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { completeBrandClaim } from './brands'

type BrandRow = Database['public']['Tables']['brands']['Row']

type ClaimRequestStatus = 'pending' | 'approved' | 'rejected'
type ClaimProofType = 'domain_email' | 'social_post' | 'business_registration'

type ClaimRequestRow = {
  id: string
  brand_id: string
  user_id: string
  proof_type: string
  proof_url: string | null
  proof_notes: string | null
  status: string
  reviewer_notes: string | null
  reviewed_at: string | null
  reviewed_by: string | null
  created_at: string
}

type ClaimRequestRowWithJoins = ClaimRequestRow & {
  brands?: Pick<BrandRow, 'name' | 'slug'> | null
  requester_email?: string | null
}

type ClaimRequestError = {
  code?: string
  message: string
}

type ClaimRequestSingleResult<T> = Promise<{
  data: T | null
  error: ClaimRequestError | null
}>

type ClaimRequestManyResult<T> = Promise<{
  data: T[] | null
  error: ClaimRequestError | null
}>

type ClaimRequestSelectBuilder = {
  eq(column: string, value: string): ClaimRequestSelectBuilder
  order(column: string, options: { ascending: boolean }): ClaimRequestManyResult<ClaimRequestRowWithJoins>
  single(): ClaimRequestSingleResult<ClaimRequestRowWithJoins>
}

type ClaimRequestTable = {
  insert(values: Record<string, unknown>): {
    select(columns: string): {
      single(): ClaimRequestSingleResult<ClaimRequestRow>
    }
  }
  select(columns: string): ClaimRequestSelectBuilder
  update(values: Record<string, unknown>): {
    eq(column: string, value: string): {
      select(columns: string): {
        single(): ClaimRequestSingleResult<{ id: string }>
      }
    }
  }
}

export type ClaimRequest = {
  id: string
  brandId: string
  userId: string
  proofType: ClaimProofType
  proofUrl: string | null
  proofNotes: string | null
  status: ClaimRequestStatus
  reviewerNotes: string | null
  reviewedAt: string | null
  reviewedBy: string | null
  createdAt: string
  brandName: string | null
  brandSlug: string | null
  requesterEmail: string | null
}

export function rowToClaimRequest(row: ClaimRequestRowWithJoins): ClaimRequest {
  return {
    id: row.id,
    brandId: row.brand_id,
    userId: row.user_id,
    proofType: row.proof_type as ClaimProofType,
    proofUrl: row.proof_url ?? null,
    proofNotes: row.proof_notes ?? null,
    status: row.status as ClaimRequestStatus,
    reviewerNotes: row.reviewer_notes ?? null,
    reviewedAt: row.reviewed_at ?? null,
    reviewedBy: row.reviewed_by ?? null,
    createdAt: row.created_at,
    brandName: row.brands?.name ?? null,
    brandSlug: row.brands?.slug ?? null,
    requesterEmail: row.requester_email ?? null,
  }
}

function claimRequestsTable(client: unknown): ClaimRequestTable {
  return (client as { from: (table: 'claim_requests') => ClaimRequestTable }).from('claim_requests')
}

async function attachRequesterEmails(rows: ClaimRequestRowWithJoins[]): Promise<ClaimRequest[]> {
  const supabase = createServiceClient()
  const userIds = [...new Set(rows.map((row) => row.user_id))]

  const emailEntries = await Promise.all(
    userIds.map(async (userId) => {
      const { data, error } = await supabase.auth.admin.getUserById(userId)
      if (error) throw error
      return [userId, data.user.email ?? null] as const
    })
  )

  const emailByUserId = new Map<string, string | null>(emailEntries)
  return rows.map((row) =>
    rowToClaimRequest({
      ...row,
      requester_email: emailByUserId.get(row.user_id) ?? null,
    })
  )
}

export async function createClaimRequest(input: {
  userId: string
  brandId: string
  proofType: ClaimProofType
  proofUrl?: string
  proofNotes?: string
}): Promise<ClaimRequest> {
  const supabase = await createClient()
  const { data, error } = await claimRequestsTable(supabase)
    .insert({
      user_id: input.userId,
      brand_id: input.brandId,
      proof_type: input.proofType,
      proof_url: input.proofUrl ?? null,
      proof_notes: input.proofNotes ?? null,
    })
    .select('*')
    .single()

  if (error) throw error
  return rowToClaimRequest(data as ClaimRequestRowWithJoins)
}

export async function listClaimRequests(status?: ClaimRequestStatus): Promise<ClaimRequest[]> {
  const supabase = createServiceClient()
  let query = claimRequestsTable(supabase).select('*, brands(name, slug)')

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error } = await query.order('created_at', { ascending: false })

  if (error) throw error
  return attachRequesterEmails((data ?? []) as ClaimRequestRowWithJoins[])
}

export async function getClaimRequest(id: string): Promise<ClaimRequest> {
  const supabase = createServiceClient()
  const { data, error } = await claimRequestsTable(supabase)
    .select('*, brands(name, slug)')
    .eq('id', id)
    .single()

  if (error || !data) throw new NotFoundError('ClaimRequest', id)

  const [request] = await attachRequesterEmails([data as ClaimRequestRowWithJoins])
  return request
}

export async function approveClaimRequest(id: string, reviewerId: string): Promise<void> {
  const request = await getClaimRequest(id)
  if (!request.requesterEmail) {
    throw new ValidationError('Claim requester email not found')
  }

  try {
    await completeBrandClaim({
      userId: request.userId,
      brandId: request.brandId,
      email: request.requesterEmail,
    })
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new ValidationError('This brand has already been claimed')
    }
    throw error
  }

  const supabase = createServiceClient()
  const { data, error } = await claimRequestsTable(supabase)
    .update({
      status: 'approved',
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerId,
    })
    .eq('id', id)
    .select('id')
    .single()

  if (error || !data) throw new NotFoundError('ClaimRequest', id)
}

export async function rejectClaimRequest(
  id: string,
  reviewerId: string,
  notes: string
): Promise<void> {
  const supabase = createServiceClient()
  const { data, error } = await claimRequestsTable(supabase)
    .update({
      status: 'rejected',
      reviewer_notes: notes,
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerId,
    })
    .eq('id', id)
    .select('id')
    .single()

  if (error || !data) throw new NotFoundError('ClaimRequest', id)
}
