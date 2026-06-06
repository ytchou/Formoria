import type { Brand } from '@/lib/types'
import type { Database } from '@/lib/supabase/database.types'
import { NotFoundError } from '@/lib/errors'
import { createServiceClient } from '@/lib/supabase/server'
import { buildReviewUpdate } from './review-status'
import { brandToDomain as mapBrandRowToDomain, type BrandRowWithJoins } from './brands'

type BrandUpdate = Database['public']['Tables']['brands']['Update']

const BRAND_SELECT =
  '*, mit_status, mit_verified_at, mit_evidence, brand_taxonomy(taxonomy_tags(*)), brand_owners(user_id)'

function buildMitStatusUpdate(
  status: 'verified' | 'rejected',
  evidence: NonNullable<Brand['mitEvidence']>
): BrandUpdate {
  const reviewUpdate = buildReviewUpdate(status === 'verified' ? 'reviewed' : 'dismissed')
  const mitVerifiedAt =
    typeof reviewUpdate.reviewed_at === 'string' ? reviewUpdate.reviewed_at : null

  return {
    mit_status: status,
    mit_verified_at: mitVerifiedAt,
    mit_evidence: evidence,
  }
}

async function updateMitStatus(brandId: string, update: BrandUpdate): Promise<Brand> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brands')
    .update(update)
    .eq('id', brandId)
    .select(BRAND_SELECT)
    .single()

  if (error || !data) {
    throw new NotFoundError('Brand', brandId)
  }

  return mapBrandRowToDomain(data as BrandRowWithJoins)
}

export async function verifyMitStatus(
  brandId: string,
  cert: string,
  reviewerId: string
): Promise<Brand> {
  return updateMitStatus(
    brandId,
    buildMitStatusUpdate('verified', {
      mit_smile_listed: true,
      mit_smile_cert: cert,
      verified_source: 'mit_smile_registry',
      verified_by: reviewerId,
    })
  )
}

export async function rejectMitStatus(
  brandId: string,
  reviewerId: string,
  notes: string
): Promise<Brand> {
  return updateMitStatus(
    brandId,
    buildMitStatusUpdate('rejected', {
      rejected_reason: notes,
      verified_by: reviewerId,
    } as NonNullable<Brand['mitEvidence']>)
  )
}
