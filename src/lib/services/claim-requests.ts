import type { Database, Json } from '@/lib/supabase/database.types'
import { timingSafeEqual } from 'node:crypto'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { createServiceClient } from '@/lib/supabase/server'
import { generateVerificationToken, hashToken } from '@/lib/utils/token'
import { CLAIM_PROOF_TYPES } from './claim-proofs'
import type { ClaimProofType, ProofEvidence } from './claim-proofs'

export { CLAIM_PROOF_TYPES } from './claim-proofs'
export type { ProofEvidence } from './claim-proofs'

type BrandRow = Database['public']['Tables']['brands']['Row']
type BrandOwnerRow = Database['public']['Tables']['brand_owners']['Row']

type ClaimRequestStatus = 'pending' | 'approved' | 'rejected'
type ClaimProofCleanupStatus = 'pending' | 'failed' | 'completed' | null
const MAX_PROOF_URL_LENGTH = 2048
const CLAIM_PROOF_BUCKET = 'claim-proofs'
const CLAIM_PROOF_BUCKET_PREFIX = `${CLAIM_PROOF_BUCKET}/`
const CLAIM_PROOF_SIGNED_URL_EXPIRES_IN_SECONDS = 300
const DUPLICATE_PENDING_CLAIM_ERROR = 'a pending claim already exists for this brand'
const CLAIM_ALREADY_REVIEWED_ERROR = 'claim already reviewed'
const CLAIM_REQUESTER_EMAIL_NOT_FOUND_ERROR = 'Claim requester email not found'
const DOMAIN_EMAIL_PROOF_NOT_VERIFIED_ERROR = 'domain email proof not verified'
const DOMAIN_EMAIL_PROOF_NOT_VERIFIED_MESSAGE =
  'Domain email proof must be verified before approval'
const CLAIM_REQUEST_SELECT =
  'id, brand_id, user_id, proof_type, proof_url, proof_notes, proof_evidence, mit_smile_cert, status, reviewer_notes, reviewed_at, reviewed_by, created_at'
const CLAIM_REQUEST_WITH_BRAND_SELECT = `${CLAIM_REQUEST_SELECT}, brands(name, slug)`
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

type ClaimRequestVerificationToken = {
  proofIndex: number
  email: string
  token: string
  expiresAt: string
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

type ClaimRequestManyResponse<T> = Awaited<ClaimRequestManyResult<T>>

type ClaimRequestUpdateSelectResult<T> = Promise<{
  data: T | null
  error: ClaimRequestError | null
}>

type ClaimRequestSelectBuilder = PromiseLike<ClaimRequestManyResponse<ClaimRequestRowWithJoins>> & {
  eq(column: string, value: string): ClaimRequestSelectBuilder
  order(column: string, options: { ascending: boolean }): ClaimRequestSelectBuilder
  limit(count: number): ClaimRequestSelectBuilder
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

type ClaimProofCleanupJobRow = {
  claim_request_id: string | null
  storage_key: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
}

type ClaimProofCleanupJobsTable = {
  select(columns: string): {
    in(
      column: 'claim_request_id',
      values: string[]
    ): Promise<{ data: ClaimProofCleanupJobRow[] | null; error: ClaimRequestError | null }>
  }
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
  proofCleanupStatus: ClaimProofCleanupStatus
  existingOwnedBrand?: {
    brandId: string
    brandName: string
    brandSlug: string
  } | null
}

export type ClaimRequestWithSignedProofs = Omit<ClaimRequest, 'proofEvidence'> & {
  proofEvidence: Array<ProofEvidence & { signedUrl?: string }>
}

export type CreateClaimRequestResult = ClaimRequest & {
  emailVerificationTokens: ClaimRequestVerificationToken[]
}

export type VerifyClaimEmailProofResult = {
  ok: boolean
  brandSlug?: string
  locale?: 'zh-TW' | 'en'
  reason?: string
}

function rowToClaimRequest(row: ClaimRequestRowWithJoins): ClaimRequest {
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
    proofCleanupStatus: null,
    existingOwnedBrand: null,
  }
}

function claimRequestsTable(client: unknown): ClaimRequestTable {
  return (client as { from: (table: 'claim_requests') => ClaimRequestTable }).from('claim_requests')
}

function claimRequestRpcClient(client: unknown): ClaimRequestRpcClient {
  return client as ClaimRequestRpcClient
}

function claimProofCleanupJobsTable(client: unknown): ClaimProofCleanupJobsTable {
  return (client as { from: (table: 'claim_proof_cleanup_jobs') => ClaimProofCleanupJobsTable })
    .from('claim_proof_cleanup_jobs')
}

async function attachProofCleanupStatuses(
  client: unknown,
  claims: ClaimRequest[]
): Promise<ClaimRequest[]> {
  const terminalClaimsWithUploads = claims.filter(
    (claim) => claim.status !== 'pending' && claim.proofEvidence.some((proof) => proof.imageKey)
  )
  if (terminalClaimsWithUploads.length === 0) return claims

  const claimIds = terminalClaimsWithUploads.map((claim) => claim.id)
  const { data, error } = await claimProofCleanupJobsTable(client)
    .select('claim_request_id, storage_key, status')
    .in('claim_request_id', claimIds)
  if (error) throw error

  const jobsByClaimId = new Map<string, ClaimProofCleanupJobRow[]>()
  for (const job of data ?? []) {
    if (!job.claim_request_id) continue
    const jobs = jobsByClaimId.get(job.claim_request_id) ?? []
    jobs.push(job)
    jobsByClaimId.set(job.claim_request_id, jobs)
  }

  return claims.map((claim) => {
    const expectedStorageKeys = new Set(
      claim.proofEvidence.flatMap((proof) => (proof.imageKey ? [proof.imageKey] : []))
    )
    if (claim.status === 'pending' || expectedStorageKeys.size === 0) return claim

    const jobs = (jobsByClaimId.get(claim.id) ?? []).filter((job) =>
      expectedStorageKeys.has(job.storage_key)
    )
    let proofCleanupStatus: Exclude<ClaimProofCleanupStatus, null>
    if (jobs.some((job) => job.status === 'failed')) {
      proofCleanupStatus = 'failed'
    } else if (
      jobs.some((job) => job.status === 'pending' || job.status === 'processing') ||
      [...expectedStorageKeys].some(
        (storageKey) => !jobs.some((job) => job.storage_key === storageKey)
      )
    ) {
      proofCleanupStatus = 'pending'
    } else {
      proofCleanupStatus = 'completed'
    }

    return { ...claim, proofCleanupStatus }
  })
}

function normalizeDomainEmail(email?: string): string | null {
  const trimmed = email?.trim()
  if (!trimmed) return null

  if (trimmed.length > MAX_PROOF_URL_LENGTH) {
    throw new ValidationError(`domain email must be ${MAX_PROOF_URL_LENGTH} characters or fewer`)
  }

  if (!EMAIL_PATTERN.test(trimmed)) {
    throw new ValidationError('domain email must be a valid email address')
  }

  return trimmed
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
    if (typeof record.verified === 'boolean') proof.verified = record.verified
    if (typeof record.verifiedAt === 'string') proof.verifiedAt = record.verifiedAt
    return [proof]
  })
}

function normalizeProofEvidence(input: ProofEvidence[], userId: string): ProofEvidence[] {
  const imageNamespace = `${CLAIM_PROOF_BUCKET}/${userId}/`
  const normalized = input.map((proof) => {
    if (!isClaimProofType(proof.type)) {
      throw new ValidationError('proofEvidence contains an invalid proof type')
    }

    const url = proof.type === 'domain_email' ? normalizeDomainEmail(proof.url) ?? undefined : undefined
    const imageKey = proof.imageKey?.trim() || undefined
    const note = proof.note?.trim() || undefined

    if (proof.type === 'domain_email' && !url) {
      throw new ValidationError('Domain email proof must include a valid email address')
    }

    if ((proof.type === 'backend_screenshot' || proof.type === 'business_doc') && !imageKey) {
      throw new ValidationError('Screenshot and business document proofs must include an image key')
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

  if (normalized.length < 1) {
    throw new ValidationError('Please provide at least 1 proof')
  }

  return normalized
}

function addDomainEmailVerificationTokens(proofEvidence: ProofEvidence[]): {
  proofEvidence: ProofEvidence[]
  emailVerificationTokens: ClaimRequestVerificationToken[]
} {
  const emailVerificationTokens: ClaimRequestVerificationToken[] = []
  const proofEvidenceWithTokens = proofEvidence.map((proof, proofIndex) => {
    if (proof.type !== 'domain_email' || !proof.url) {
      return proof
    }

    const verification = generateVerificationToken()
    emailVerificationTokens.push({
      proofIndex,
      email: proof.url,
      token: verification.token,
      expiresAt: verification.expiresAt,
    })

    return {
      ...proof,
      verified: false,
      tokenHash: verification.tokenHash,
      tokenExpiresAt: verification.expiresAt,
    }
  })

  return { proofEvidence: proofEvidenceWithTokens, emailVerificationTokens }
}

function tokenHashesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex')
  const rightBuffer = Buffer.from(right, 'hex')
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
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

  const { data: ownershipRows, error: ownershipError } = userIds.length > 0
    ? await supabase
        .from('brand_owners')
        .select('user_id, brand_id, brands(name, slug)')
        .in('user_id', userIds)
    : { data: [], error: null }

  if (ownershipError) throw ownershipError

  const ownedBrandByUserId = new Map(
    (ownershipRows ?? []).map((row) => {
      const brand = row.brands as unknown as { name: string; slug: string }
      return [row.user_id, {
        brandId: row.brand_id,
        brandName: brand.name,
        brandSlug: brand.slug,
      }] as const
    })
  )
  const emailByUserId = new Map<string, string | null>(emailEntries)
  const claims = rows.map((row) =>
    ({
      ...rowToClaimRequest({
        ...row,
        requester_email: emailByUserId.get(row.user_id) ?? null,
      }),
      existingOwnedBrand: ownedBrandByUserId.get(row.user_id) ?? null,
    })
  )
  return attachProofCleanupStatuses(supabase, claims)
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
}): Promise<CreateClaimRequestResult> {
  const normalizedProofEvidence = normalizeProofEvidence(input.proofEvidence, input.userId)
  const { proofEvidence, emailVerificationTokens } =
    addDomainEmailVerificationTokens(normalizedProofEvidence)
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

  const { data: existingUserOwnership, error: existingUserOwnershipError } = await supabase
    .from('brand_owners')
    .select('brand_id')
    .eq('user_id', input.userId)
    .maybeSingle()

  if (existingUserOwnershipError) throw existingUserOwnershipError
  if (existingUserOwnership) {
    throw new ValidationError('This account already manages a brand')
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
      throw new ValidationError(DUPLICATE_PENDING_CLAIM_ERROR, { cause: error })
    }
    throw error
  }
  return {
    ...rowToClaimRequest(data as ClaimRequestRowWithJoins),
    emailVerificationTokens,
  }
}

export async function verifyClaimEmailProof({
  claimRequestId,
  proofIndex,
  token,
}: {
  claimRequestId: string
  proofIndex: number
  token: string
}): Promise<VerifyClaimEmailProofResult> {
  if (!claimRequestId || !Number.isInteger(proofIndex) || proofIndex < 0 || !token) {
    return { ok: false, locale: 'zh-TW', reason: 'invalid_request' }
  }

  const supabase = createServiceClient()
  const { data, error } = await claimRequestsTable(supabase)
    .select(CLAIM_REQUEST_WITH_BRAND_SELECT)
    .eq('id', claimRequestId)
    .maybeSingle()

  if (error || !data) {
    return { ok: false, locale: 'zh-TW', reason: 'not_found' }
  }

  const row = data as ClaimRequestRowWithJoins
  const rawProofEvidence = Array.isArray(row.proof_evidence) ? row.proof_evidence : []
  const proof = rawProofEvidence[proofIndex]
  const brandSlug = row.brands?.slug ?? undefined
  const failure = (reason: string): VerifyClaimEmailProofResult => ({
    ok: false,
    brandSlug,
    locale: 'zh-TW',
    reason,
  })

  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
    return failure('proof_not_found')
  }

  const proofRecord = proof as Record<string, Json | undefined>
  if (proofRecord.type !== 'domain_email') {
    return failure('wrong_proof_type')
  }

  if (proofRecord.verified === true) {
    return {
      ok: true,
      brandSlug,
      locale: 'zh-TW',
    }
  }

  if (typeof proofRecord.tokenHash !== 'string') {
    return failure('missing_token')
  }

  const tokenExpiresAt = typeof proofRecord.tokenExpiresAt === 'string'
    ? Date.parse(proofRecord.tokenExpiresAt)
    : Number.NaN
  if (!Number.isFinite(tokenExpiresAt) || tokenExpiresAt <= Date.now()) {
    return failure('expired')
  }

  if (!tokenHashesMatch(hashToken(token), proofRecord.tokenHash)) {
    return failure('invalid_token')
  }

  const nextProofEvidence = rawProofEvidence.map((item, index) => {
    if (index !== proofIndex || !item || typeof item !== 'object' || Array.isArray(item)) {
      return item
    }

    const { tokenHash: _tokenHash, tokenExpiresAt: _tokenExpiresAt, ...rest } = item as Record<
      string,
      Json | undefined
    >
    void _tokenHash
    void _tokenExpiresAt
    return {
      ...rest,
      verified: true,
      verifiedAt: new Date().toISOString(),
    }
  })

  const { error: updateError } = await claimRequestsTable(supabase)
    .update({ proof_evidence: nextProofEvidence as Json })
    .eq('id', claimRequestId)
    .select('id')
    .single()

  if (updateError) {
    throw updateError
  }

  return {
    ok: true,
    brandSlug,
    locale: 'zh-TW',
  }
}

export async function hasPendingClaim(userId: string, brandId: string): Promise<boolean> {
  const supabase = createServiceClient()
  const { data, error } = await claimRequestsTable(supabase)
    .select('id')
    .eq('user_id', userId)
    .eq('brand_id', brandId)
    .eq('status', 'pending')
    .maybeSingle()

  if (error) throw error
  return Boolean(data)
}

export async function listClaimRequests(
  status?: ClaimRequestStatus,
  options?: { limit?: number }
): Promise<ClaimRequest[]> {
  const supabase = createServiceClient()
  let query = claimRequestsTable(supabase).select(CLAIM_REQUEST_WITH_BRAND_SELECT)

  if (status) {
    query = query.eq('status', status)
  }

  query = query.order('created_at', { ascending: false })
  if (options?.limit) {
    query = query.limit(options.limit)
  }

  const { data, error } = await query

  if (error) throw error
  return attachRequesterEmails((data ?? []) as ClaimRequestRowWithJoins[])
}

export async function getClaimRequest(id: string): Promise<ClaimRequest> {
  const supabase = createServiceClient()
  const { data, error } = await claimRequestsTable(supabase)
    .select(CLAIM_REQUEST_WITH_BRAND_SELECT)
    .eq('id', id)
    .single()

  if (error || !data) throw new NotFoundError('ClaimRequest', id, { cause: error })

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

  if (error.message.includes('already manages a brand')) {
    throw new ValidationError('This account already manages a brand', { cause: error })
  }

  if (error.code === '23505' || error.message.includes('already been claimed')) {
    throw new ValidationError('This brand has already been claimed', { cause: error })
  }

  if (error.message.includes(CLAIM_ALREADY_REVIEWED_ERROR)) {
    throw new ValidationError(CLAIM_ALREADY_REVIEWED_ERROR, { cause: error })
  }

  if (error.message.includes(CLAIM_REQUESTER_EMAIL_NOT_FOUND_ERROR)) {
    throw new ValidationError(CLAIM_REQUESTER_EMAIL_NOT_FOUND_ERROR, { cause: error })
  }

  if (error.message.includes(DOMAIN_EMAIL_PROOF_NOT_VERIFIED_ERROR)) {
    throw new ValidationError(DOMAIN_EMAIL_PROOF_NOT_VERIFIED_MESSAGE, { cause: error })
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
