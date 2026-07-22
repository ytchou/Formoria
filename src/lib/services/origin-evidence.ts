import { buildDeclarationRemovedEmail } from '@/lib/email/templates'
import { sendEmail } from '@/lib/email/send'
import type { Database } from '@/lib/supabase/database.types'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { stripDeclaration } from './mit-declaration'

const MAX_NOTES_LENGTH = 1000
const MAX_PENDING_EVIDENCE = 3
const DEFAULT_PENDING_PAGE_SIZE = 20
const MAX_PENDING_PAGE_SIZE = 100
const ORIGIN_EVIDENCE_BUCKET = 'origin-evidence'
const ORIGIN_EVIDENCE_BUCKET_PREFIX = `${ORIGIN_EVIDENCE_BUCKET}/`
const ORIGIN_EVIDENCE_SIGNED_URL_EXPIRES_IN_SECONDS = 300

type OriginEvidenceRow = Database['public']['Tables']['origin_evidence']['Row']
type OriginEvidenceInsert = Database['public']['Tables']['origin_evidence']['Insert']

export type OriginEvidenceStance = 'supports' | 'contradicts'
export type OriginEvidenceSourceType =
  | 'product_label'
  | 'packaging'
  | 'official_site'
  | 'in_store'
  | 'other'
export type OriginEvidenceStatus = 'pending' | 'approved' | 'rejected'
export type OriginEvidenceDecision = Exclude<OriginEvidenceStatus, 'pending'>

type OriginEvidenceBrand = {
  name: string
  slug: string
  mit_status?: string
}

type OriginEvidenceRowWithBrand = OriginEvidenceRow & {
  brands?: OriginEvidenceBrand | null
}

export type OriginEvidencePhoto = {
  path: string
  signedUrl?: string
}

export type OriginEvidence = {
  id: string
  brandId: string
  userId: string
  stance: OriginEvidenceStance
  productName: string | null
  sourceType: OriginEvidenceSourceType
  notes: string
  photos: OriginEvidencePhoto[]
  status: OriginEvidenceStatus
  reviewedAt: string | null
  reviewedBy: string | null
  reviewerNotes: string | null
  createdAt: string
  brandName: string | null
  brandSlug: string | null
  brandMitStatus: string | null
}

export type CreateEvidenceInput = {
  userId: string
  brandId: string
  stance: OriginEvidenceStance
  productName?: string | null
  sourceType: OriginEvidenceSourceType
  notes: string
  photoPaths?: string[]
}

export type CreateEvidenceResult =
  | { ok: true; id: string }
  | { ok: false; code: 'notes_too_long' | 'pending_cap_reached' | 'database_error' }

export type ReviewEvidenceOptions = {
  reviewerId: string
  tierAction?: 'strip_declaration'
  now?: () => string
}

export type ReviewEvidenceResult =
  | { ok: true }
  | { ok: false; code: string }

export type ListPendingEvidenceOptions = {
  page?: number
  pageSize?: number
  limit?: number
  offset?: number
}

function rowToEvidence(row: OriginEvidenceRowWithBrand): OriginEvidence {
  return {
    id: row.id,
    brandId: row.brand_id,
    userId: row.user_id,
    stance: row.stance as OriginEvidenceStance,
    productName: row.product_name,
    sourceType: row.source_type as OriginEvidenceSourceType,
    notes: row.notes,
    photos: row.photo_paths.map((path) => ({ path })),
    status: row.status as OriginEvidenceStatus,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    reviewerNotes: row.reviewer_notes,
    createdAt: row.created_at,
    brandName: row.brands?.name ?? null,
    brandSlug: row.brands?.slug ?? null,
    brandMitStatus: row.brands?.mit_status ?? null,
  }
}

function toOriginEvidenceBucketPath(path: string): string {
  return path.startsWith(ORIGIN_EVIDENCE_BUCKET_PREFIX)
    ? path.slice(ORIGIN_EVIDENCE_BUCKET_PREFIX.length)
    : path
}

async function attachSignedPhotoUrls(evidence: OriginEvidence[]): Promise<OriginEvidence[]> {
  const photoPaths = [
    ...new Set(evidence.flatMap((item) => item.photos.map((photo) => photo.path))),
  ]

  if (photoPaths.length === 0) return evidence

  const supabase = createServiceClient()
  const { data, error } = await supabase.storage
    .from(ORIGIN_EVIDENCE_BUCKET)
    .createSignedUrls(
      photoPaths.map(toOriginEvidenceBucketPath),
      ORIGIN_EVIDENCE_SIGNED_URL_EXPIRES_IN_SECONDS,
    )

  if (error) return evidence

  const signedUrlByPath = new Map<string, string | undefined>()
  data?.forEach((signedUrlResult, index) => {
    const photoPath = photoPaths[index]
    if (!photoPath) return
    signedUrlByPath.set(
      photoPath,
      signedUrlResult.error ? undefined : signedUrlResult.signedUrl ?? undefined,
    )
  })

  return evidence.map((item) => ({
    ...item,
    photos: item.photos.map((photo) => ({
      ...photo,
      ...(signedUrlByPath.get(photo.path)
        ? { signedUrl: signedUrlByPath.get(photo.path) }
        : {}),
    })),
  }))
}

export async function createEvidence(input: CreateEvidenceInput): Promise<CreateEvidenceResult> {
  if (input.notes.length > MAX_NOTES_LENGTH) {
    return { ok: false, code: 'notes_too_long' }
  }

  const supabase = await createClient()
  const { count, error: countError } = await supabase
    .from('origin_evidence')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', input.userId)
    .eq('brand_id', input.brandId)
    .eq('status', 'pending')

  if (countError) return { ok: false, code: 'database_error' }
  if ((count ?? 0) >= MAX_PENDING_EVIDENCE) {
    return { ok: false, code: 'pending_cap_reached' }
  }

  const row: OriginEvidenceInsert = {
    user_id: input.userId,
    brand_id: input.brandId,
    stance: input.stance,
    product_name: input.productName ?? null,
    source_type: input.sourceType,
    notes: input.notes,
    photo_paths: input.photoPaths ?? [],
    status: 'pending',
  }
  const { data, error } = await supabase
    .from('origin_evidence')
    .insert(row)
    .select('id')
    .single()

  if (error || !data) return { ok: false, code: 'database_error' }
  return { ok: true, id: data.id }
}

export async function listMyEvidence(userId: string): Promise<OriginEvidence[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('origin_evidence')
    .select('*, brands(name, slug)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  const evidence = ((data ?? []) as unknown as OriginEvidenceRowWithBrand[]).map(rowToEvidence)
  return attachSignedPhotoUrls(evidence)
}

export async function listPendingEvidence(
  options: ListPendingEvidenceOptions = {},
): Promise<OriginEvidence[]> {
  const requestedLimit = options.limit ?? options.pageSize ?? DEFAULT_PENDING_PAGE_SIZE
  const limit = Math.min(Math.max(1, requestedLimit), MAX_PENDING_PAGE_SIZE)
  const pageOffset = Math.max(0, (options.page ?? 1) - 1) * limit
  const offset = Math.max(0, options.offset ?? pageOffset)
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('origin_evidence')
    .select('*, brands(name, slug, mit_status)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) throw error
  const evidence = ((data ?? []) as unknown as OriginEvidenceRowWithBrand[]).map(rowToEvidence)
  return attachSignedPhotoUrls(evidence)
}

export async function reviewEvidence(
  id: string,
  decision: OriginEvidenceDecision,
  notes: string,
  opts: ReviewEvidenceOptions,
): Promise<ReviewEvidenceResult> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('origin_evidence')
    .update({
      status: decision,
      reviewed_at: opts.now?.() ?? new Date().toISOString(),
      reviewed_by: opts.reviewerId,
      reviewer_notes: notes,
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id, brand_id, brands(name)')
    .maybeSingle()

  if (error) return { ok: false, code: 'database_error' }
  if (!data) return { ok: false, code: 'already_reviewed_or_not_found' }
  if (opts.tierAction !== 'strip_declaration') return { ok: true }

  const stripResult = await stripDeclaration(data.brand_id, opts.reviewerId, notes)
  if (!stripResult.ok) return stripResult

  const brand = data.brands as unknown as Pick<OriginEvidenceBrand, 'name'> | null
  try {
    const { data: owner, error: ownerError } = await supabase
      .from('brand_owners')
      .select('user_id')
      .eq('brand_id', data.brand_id)
      .maybeSingle()

    if (ownerError) throw ownerError
    if (!owner || !brand) return { ok: true }

    const { data: ownerUser, error: ownerUserError } =
      await supabase.auth.admin.getUserById(owner.user_id)
    if (ownerUserError) throw ownerUserError
    if (!ownerUser.user.email) return { ok: true }

    const message = await buildDeclarationRemovedEmail({
      ownerEmail: ownerUser.user.email,
      brandName: brand.name,
      reviewerNotes: notes,
    })
    const sendResult = await sendEmail(message)
    if (!sendResult.success) {
      console.error('[origin-evidence:declaration-removed-email] send failed', {
        evidenceId: id,
        brandId: data.brand_id,
        ownerId: owner.user_id,
        error: sendResult.error,
      })
    }
  } catch (emailError) {
    console.error('[origin-evidence:declaration-removed-email] send failed', {
      evidenceId: id,
      brandId: data.brand_id,
      error: emailError instanceof Error ? emailError.message : String(emailError),
    })
  }

  return { ok: true }
}
