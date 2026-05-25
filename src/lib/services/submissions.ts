import type { BrandSubmission, SubmissionStatus, SourceAttribution } from '@/lib/types'
import { NotFoundError } from '@/lib/errors'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Pure record builder (no DB calls — testable in isolation)
// ---------------------------------------------------------------------------

export type CreateSubmissionInput = {
  brandId?: string
  brandName: string
  submitterEmail: string
  submitterName?: string
  description?: string
  websiteUrl?: string
  logoUrl?: string
  socialLinks?: Record<string, string>
  suggestedTags?: string[]
  pdpaConsentAt?: string
  isOwner?: boolean
  sourceAttribution?: SourceAttribution | null
}

export function buildSubmissionRecord(input: CreateSubmissionInput): Record<string, unknown> {
  return {
    brand_id: input.brandId ?? null,
    brand_name: input.brandName,
    submitter_email: input.submitterEmail,
    submitter_name: input.submitterName ?? null,
    description: input.description ?? null,
    website_url: input.websiteUrl ?? null,
    logo_url: input.logoUrl ?? null,
    social_links: input.socialLinks ?? {},
    suggested_tags: input.suggestedTags ?? [],
    pdpa_consent_at: input.pdpaConsentAt ?? null,
    is_brand_owner: input.isOwner ?? false,
    source_attribution: input.sourceAttribution ?? null,
  }
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
export function submissionToDomain(row: any): BrandSubmission {
  return {
    id: row.id,
    brandId: row.brand_id ?? null,
    brandName: row.brand_name,
    submitterEmail: row.submitter_email,
    submitterName: row.submitter_name ?? null,
    description: row.description ?? null,
    websiteUrl: row.website_url ?? null,
    socialLinks: row.social_links ?? {},
    suggestedTags: row.suggested_tags ?? [],
    status: row.status,
    reviewerNotes: row.reviewer_notes ?? null,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at ?? null,
    reviewedBy: row.reviewed_by ?? null,
    pdpaConsentAt: row.pdpa_consent_at ?? null,
    validationStatus: row.validation_status ?? null,
    validationErrors: row.validation_errors ?? null,
    notifiedAt: row.notified_at ?? null,
    isBrandOwner: row.is_brand_owner ?? false,
  }
}

export function submissionToInsert(data: Partial<BrandSubmission>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (data.brandId !== undefined) row.brand_id = data.brandId
  if (data.brandName !== undefined) row.brand_name = data.brandName
  if (data.submitterEmail !== undefined) row.submitter_email = data.submitterEmail
  if (data.submitterName !== undefined) row.submitter_name = data.submitterName
  if (data.description !== undefined) row.description = data.description
  if (data.websiteUrl !== undefined) row.website_url = data.websiteUrl
  if (data.socialLinks !== undefined) row.social_links = data.socialLinks
  if (data.suggestedTags !== undefined) row.suggested_tags = data.suggestedTags
  if (data.status !== undefined) row.status = data.status
  if (data.reviewerNotes !== undefined) row.reviewer_notes = data.reviewerNotes
  if (data.pdpaConsentAt !== undefined) row.pdpa_consent_at = data.pdpaConsentAt
  if (data.validationStatus !== undefined) row.validation_status = data.validationStatus
  if (data.validationErrors !== undefined) row.validation_errors = data.validationErrors
  if (data.notifiedAt !== undefined) row.notified_at = data.notifiedAt
  if (data.isBrandOwner !== undefined) row.is_brand_owner = data.isBrandOwner
  if (data.sourceAttribution !== undefined) row.source_attribution = data.sourceAttribution
  return row
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function createSubmission(
  data: Pick<BrandSubmission, 'brandName' | 'submitterEmail'> &
    Partial<Pick<BrandSubmission, 'brandId' | 'submitterName' | 'description' | 'websiteUrl' | 'socialLinks' | 'suggestedTags' | 'pdpaConsentAt' | 'isBrandOwner' | 'sourceAttribution'>>
): Promise<BrandSubmission> {
  // Public insert — use anon client with RLS (policy allows anonymous inserts)
  const supabase = await createClient()
  const row = submissionToInsert(data)
  const { data: inserted, error } = await supabase
    .from('brand_submissions')
    .insert(row)
    .select('*')
    .single()

  if (error) throw error
  return submissionToDomain(inserted)
}

export async function getSubmission(id: string): Promise<BrandSubmission> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brand_submissions')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) throw new NotFoundError('BrandSubmission', id)
  return submissionToDomain(data)
}

export async function getSubmissions(status?: SubmissionStatus): Promise<BrandSubmission[]> {
  const supabase = createServiceClient()
  let query = supabase.from('brand_submissions').select('*')

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error } = await query.order('submitted_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map(submissionToDomain)
}

export async function approveSubmission(id: string, reviewerId: string): Promise<BrandSubmission> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brand_submissions')
    .update({
      status: 'approved',
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerId,
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error || !data) throw new NotFoundError('BrandSubmission', id)
  return submissionToDomain(data)
}

export async function rejectSubmission(
  id: string,
  reviewerId: string,
  notes?: string
): Promise<BrandSubmission> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brand_submissions')
    .update({
      status: 'rejected',
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerId,
      reviewer_notes: notes ?? null,
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error || !data) throw new NotFoundError('BrandSubmission', id)
  return submissionToDomain(data)
}

export type UserSubmissionSummary = {
  id: string
  brandName: string
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
}

export async function getUserSubmissions(userEmail: string): Promise<UserSubmissionSummary[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('brand_submissions')
    .select('id, brand_name, status, submitted_at')
    .eq('submitter_email', userEmail)
    .order('submitted_at', { ascending: false })

  if (error) throw error

  return (data ?? []).map((row) => ({
    id: row.id,
    brandName: row.brand_name,
    status: (row.status as 'pending' | 'approved' | 'rejected') ?? 'pending',
    createdAt: row.submitted_at,
  }))
}
