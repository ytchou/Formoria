import type { Database } from '@/lib/supabase/database.types'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { createServiceClient } from '@/lib/supabase/server'

type BrandRow = Database['public']['Tables']['brands']['Row']
type BrandOwnerRow = Database['public']['Tables']['brand_owners']['Row']

type ClaimRequestStatus = 'pending' | 'approved' | 'rejected'
type ClaimProofType = 'domain_email' | 'social_post' | 'business_registration'
const MAX_PROOF_URL_LENGTH = 2048
const DUPLICATE_PENDING_CLAIM_ERROR = 'a pending claim already exists for this brand'
const CLAIM_ALREADY_REVIEWED_ERROR = 'claim already reviewed'
const CLAIM_REQUESTER_EMAIL_NOT_FOUND_ERROR = 'Claim requester email not found'
const CLAIM_REQUEST_SELECT =
  'id, brand_id, user_id, proof_type, proof_url, proof_notes, mit_smile_cert, status, reviewer_notes, reviewed_at, reviewed_by, created_at'
const CLAIM_REQUEST_WITH_BRAND_SELECT = `${CLAIM_REQUEST_SELECT}, brands(name, slug)`

type ClaimRequestRow = {
  id: string
  brand_id: string
  user_id: string
  proof_type: string
  proof_url: string | null
  proof_notes: string | null
  mit_smile_cert: string | null
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

type ClaimRequestUpdateSelectResult<T> = Promise<{
  data: T | null
  error: ClaimRequestError | null
}>

type ClaimRequestSelectBuilder = {
  eq(column: string, value: string): ClaimRequestSelectBuilder
  order(column: string, options: { ascending: boolean }): ClaimRequestManyResult<ClaimRequestRowWithJoins>
  single(): ClaimRequestSingleResult<ClaimRequestRowWithJoins>
  maybeSingle(): ClaimRequestSingleResult<ClaimRequestRowWithJoins>
}

type ClaimRequestUpdateBuilder = {
  eq(column: string, value: string): ClaimRequestUpdateBuilder
  select(columns: string): {
    single(): ClaimRequestUpdateSelectResult<{ id: string }>
    maybeSingle(): ClaimRequestUpdateSelectResult<{ id: string }>
  }
}

type ClaimRequestTable = {
  insert(values: Record<string, unknown>): {
    select(columns: string): {
      single(): ClaimRequestSingleResult<ClaimRequestRow>
    }
  }
  select(columns: string): ClaimRequestSelectBuilder
  update(values: Record<string, unknown>): ClaimRequestUpdateBuilder
}

type ClaimRequestRpcClient = {
  rpc(
    fn: 'approve_claim_request',
    params: { p_claim_id: string; p_reviewer_id: string }
  ): Promise<{ data: unknown; error: ClaimRequestError | null }>
}

export type ClaimRequest = {
  id: string
  brandId: string
  userId: string
  proofType: ClaimProofType
  proofUrl: string | null
  proofNotes: string | null
  mitSmileCert: string | null
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
    mitSmileCert: row.mit_smile_cert ?? null,
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

function claimRequestRpcClient(client: unknown): ClaimRequestRpcClient {
  return client as ClaimRequestRpcClient
}

function normalizeProofUrl(proofUrl?: string): string | null {
  const trimmed = proofUrl?.trim()
  if (!trimmed) return null

  if (trimmed.length > MAX_PROOF_URL_LENGTH) {
    throw new ValidationError(`proofUrl must be ${MAX_PROOF_URL_LENGTH} characters or fewer`)
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new ValidationError('proofUrl must be a valid http/https URL')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError('proofUrl must be a valid http/https URL')
  }

  return parsed.toString()
}

function normalizeMitSmileCert(mitSmileCert?: string | null): string | null {
  const trimmed = mitSmileCert?.trim()
  return trimmed ? trimmed : null
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
  mitSmileCert?: string | null
}): Promise<ClaimRequest> {
  const supabase = createServiceClient()
  const proofUrl = normalizeProofUrl(input.proofUrl)
  const mitSmileCert = normalizeMitSmileCert(input.mitSmileCert)

  const { data: brand, error: brandError } = await supabase
    .from('brands')
    .select('status')
    .eq('id', input.brandId)
    .maybeSingle<Pick<BrandRow, 'status'>>()

  if (brandError) throw brandError
  if (!brand) {
    throw new NotFoundError('Brand', input.brandId)
  }

  const { data: existingOwner, error: existingOwnerError } = await supabase
    .from('brand_owners')
    .select('id')
    .eq('brand_id', input.brandId)
    .maybeSingle<Pick<BrandOwnerRow, 'id'>>()

  if (existingOwnerError) throw existingOwnerError
  if (brand.status !== 'approved' || existingOwner) {
    throw new ValidationError('This brand is not available to claim')
  }

  const { data: existingPendingClaim, error: existingPendingClaimError } = await claimRequestsTable(
    supabase
  )
    .select('id')
    .eq('brand_id', input.brandId)
    .eq('user_id', input.userId)
    .eq('status', 'pending')
    .maybeSingle()

  if (existingPendingClaimError) throw existingPendingClaimError
  if (existingPendingClaim) {
    throw new ValidationError(DUPLICATE_PENDING_CLAIM_ERROR)
  }

  const { data, error } = await claimRequestsTable(supabase)
    .insert({
      user_id: input.userId,
      brand_id: input.brandId,
      proof_type: input.proofType,
      proof_url: proofUrl,
      proof_notes: input.proofNotes ?? null,
      mit_smile_cert: mitSmileCert,
    })
    .select(CLAIM_REQUEST_SELECT)
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new ValidationError(DUPLICATE_PENDING_CLAIM_ERROR)
    }
    throw error
  }
  return rowToClaimRequest(data as ClaimRequestRowWithJoins)
}

export async function listClaimRequests(status?: ClaimRequestStatus): Promise<ClaimRequest[]> {
  const supabase = createServiceClient()
  let query = claimRequestsTable(supabase).select(CLAIM_REQUEST_WITH_BRAND_SELECT)

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
    .select(CLAIM_REQUEST_WITH_BRAND_SELECT)
    .eq('id', id)
    .single()

  if (error || !data) throw new NotFoundError('ClaimRequest', id)

  const [request] = await attachRequesterEmails([data as ClaimRequestRowWithJoins])
  return request
}

export async function getClaimRequestById(id: string): Promise<ClaimRequest | null> {
  const supabase = createServiceClient()
  const { data, error } = await claimRequestsTable(supabase)
    .select(CLAIM_REQUEST_WITH_BRAND_SELECT)
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const [request] = await attachRequesterEmails([data as ClaimRequestRowWithJoins])
  return request ?? null
}

export async function approveClaimRequest(id: string, reviewerId: string): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await claimRequestRpcClient(supabase).rpc('approve_claim_request', {
    p_claim_id: id,
    p_reviewer_id: reviewerId,
  })

  if (!error) {
    return
  }

  if (error.code === '23505' || error.message.includes('already been claimed')) {
    throw new ValidationError('This brand has already been claimed')
  }

  if (error.message.includes(CLAIM_ALREADY_REVIEWED_ERROR)) {
    throw new ValidationError(CLAIM_ALREADY_REVIEWED_ERROR)
  }

  if (error.message.includes(CLAIM_REQUESTER_EMAIL_NOT_FOUND_ERROR)) {
    throw new ValidationError(CLAIM_REQUESTER_EMAIL_NOT_FOUND_ERROR)
  }

  throw error
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
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (error) throw error
  if (!data) throw new ValidationError(CLAIM_ALREADY_REVIEWED_ERROR)
}
