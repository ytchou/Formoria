import type { Database, Json } from '@/lib/supabase/database.types'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { createServiceClient } from '@/lib/supabase/server'

type BrandRow = Database['public']['Tables']['brands']['Row']
type BrandOwnerRow = Database['public']['Tables']['brand_owners']['Row']

type ClaimRequestStatus = 'pending' | 'approved' | 'rejected'
export const CLAIM_PROOF_TYPES = [
  'domain_email',
  'social_dm',
  'backend_screenshot',
  'business_doc',
] as const
export type ClaimProofType = (typeof CLAIM_PROOF_TYPES)[number]
export type ProofEvidence = {
  type: ClaimProofType
  url?: string
  imageKey?: string
  note?: string
}
export const PROOF_TYPE_I18N_KEYS: Record<ClaimProofType, string> = {
  domain_email: 'domainEmail',
  social_dm: 'socialDm',
  backend_screenshot: 'backendScreenshot',
  business_doc: 'businessDoc',
}
const MAX_PROOF_URL_LENGTH = 2048
const CLAIM_PROOF_BUCKET = 'claim-proofs'
const CLAIM_PROOF_BUCKET_PREFIX = `${CLAIM_PROOF_BUCKET}/`
const CLAIM_PROOF_SIGNED_URL_EXPIRES_IN_SECONDS = 300
const DUPLICATE_PENDING_CLAIM_ERROR = 'a pending claim already exists for this brand'
const CLAIM_ALREADY_REVIEWED_ERROR = 'claim already reviewed'
const CLAIM_REQUESTER_EMAIL_NOT_FOUND_ERROR = 'Claim requester email not found'
const CLAIM_REQUEST_SELECT =
  'id, brand_id, user_id, proof_type, proof_url, proof_notes, proof_evidence, mit_smile_cert, status, reviewer_notes, reviewed_at, reviewed_by, created_at'
const CLAIM_REQUEST_WITH_BRAND_SELECT = `${CLAIM_REQUEST_SELECT}, brands(name, slug)`

type ClaimRequestRow = {
  id: string
  brand_id: string
  user_id: string
  proof_type: string | null
  proof_url: string | null
  proof_notes: string | null
  proof_evidence?: Json | null
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
  proofEvidence: ProofEvidence[]
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

export type ClaimRequestWithSignedProofs = Omit<ClaimRequest, 'proofEvidence'> & {
  proofEvidence: Array<ProofEvidence & { signedUrl?: string }>
}

export function rowToClaimRequest(row: ClaimRequestRowWithJoins): ClaimRequest {
  const proofEvidence = parseProofEvidence(row.proof_evidence)
  const firstProof = proofEvidence[0]

  return {
    id: row.id,
    brandId: row.brand_id,
    userId: row.user_id,
    proofType: (firstProof?.type ?? row.proof_type ?? 'domain_email') as ClaimProofType,
    proofUrl: firstProof?.url ?? row.proof_url ?? null,
    proofNotes: firstProof?.note ?? row.proof_notes ?? null,
    proofEvidence,
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
    throw new ValidationError('proofUrl must be a valid URL')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'mailto:') {
    throw new ValidationError('proofUrl must be a valid URL')
  }

  return parsed.toString()
}

function isClaimProofType(value: unknown): value is ClaimProofType {
  return typeof value === 'string' && CLAIM_PROOF_TYPES.includes(value as ClaimProofType)
}

function parseProofEvidence(value: Json | null | undefined): ProofEvidence[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []

    const record = item as Record<string, Json | undefined>
    if (!isClaimProofType(record.type)) return []

    const proof: ProofEvidence = { type: record.type }
    if (typeof record.url === 'string') proof.url = record.url
    if (typeof record.imageKey === 'string') proof.imageKey = record.imageKey
    if (typeof record.note === 'string') proof.note = record.note
    return [proof]
  })
}

export function normalizeProofEvidence(input: ProofEvidence[], userId: string): ProofEvidence[] {
  const imageNamespace = `${CLAIM_PROOF_BUCKET}/${userId}/`
  const normalized = input.map((proof) => {
    if (!isClaimProofType(proof.type)) {
      throw new ValidationError('proofEvidence contains an invalid proof type')
    }

    const url = normalizeProofUrl(proof.url) ?? undefined
    const imageKey = proof.imageKey?.trim() || undefined
    const note = proof.note?.trim() || undefined

    if (!url && !imageKey) {
      throw new ValidationError('Each proof must include a URL or image key')
    }

    if (imageKey && !imageKey.startsWith(imageNamespace)) {
      throw new ValidationError('proofEvidence contains an invalid image key')
    }

    return {
      type: proof.type,
      ...(url ? { url } : {}),
      ...(imageKey ? { imageKey } : {}),
      ...(note ? { note } : {}),
    }
  })

  if (normalized.length < 2) {
    throw new ValidationError('Please provide at least 2 proofs')
  }

  return normalized
}

function normalizeMitSmileCert(mitSmileCert?: string | null): string | null {
  const trimmed = mitSmileCert?.trim()
  return trimmed ? trimmed : null
}

function toClaimProofBucketPath(imageKey: string): string {
  return imageKey.startsWith(CLAIM_PROOF_BUCKET_PREFIX)
    ? imageKey.slice(CLAIM_PROOF_BUCKET_PREFIX.length)
    : imageKey
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

export async function attachSignedProofUrls(
  claims: ClaimRequest[]
): Promise<ClaimRequestWithSignedProofs[]> {
  const imageKeys = [
    ...new Set(
      claims.flatMap((claim) =>
        claim.proofEvidence.flatMap((proof) => (proof.imageKey ? [proof.imageKey] : []))
      )
    ),
  ]

  if (imageKeys.length === 0) {
    return claims
  }

  const bucketPaths = imageKeys.map(toClaimProofBucketPath)
  const supabase = createServiceClient()
  const { data, error } = await supabase.storage
    .from(CLAIM_PROOF_BUCKET)
    .createSignedUrls(bucketPaths, CLAIM_PROOF_SIGNED_URL_EXPIRES_IN_SECONDS)

  if (error) {
    return claims
  }

  const signedUrlByImageKey = new Map<string, string | undefined>()
  data?.forEach((signedUrlResult, index) => {
    signedUrlByImageKey.set(
      imageKeys[index],
      signedUrlResult.error ? undefined : signedUrlResult.signedUrl ?? undefined
    )
  })

  return claims.map((claim) => ({
    ...claim,
    proofEvidence: claim.proofEvidence.map((proof) => ({
      ...proof,
      ...(proof.imageKey ? { signedUrl: signedUrlByImageKey.get(proof.imageKey) } : {}),
    })),
  }))
}

export async function createClaimRequest(input: {
  userId: string
  brandId: string
  proofEvidence: ProofEvidence[]
  mitSmileCert?: string | null
}): Promise<ClaimRequest> {
  const proofEvidence = normalizeProofEvidence(input.proofEvidence, input.userId)
  const supabase = createServiceClient()
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
      proof_evidence: proofEvidence as Json,
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
