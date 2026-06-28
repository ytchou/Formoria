import type { Brand } from '@/lib/types'
import type { Database } from '@/lib/supabase/database.types'
import { NotFoundError } from '@/lib/errors'
import { createServiceClient } from '@/lib/supabase/server'
import { buildReviewUpdate } from './review-status'
import {
  BRAND_SELECT,
  brandToDomain as mapBrandRowToDomain,
  type BrandRowWithJoins,
} from './brands'
import { lookupCertNumber } from '@/lib/services/mit-registry'

type BrandUpdate = Database['public']['Tables']['brands']['Update']

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
    throw new NotFoundError('Brand', brandId, { cause: error })
  }

  return mapBrandRowToDomain(data as BrandRowWithJoins)
}

export async function verifyMitStatus(
  brandId: string,
  cert: string | null,
  reviewerId: string
): Promise<Brand> {
  return updateMitStatus(
    brandId,
    buildMitStatusUpdate('verified', {
      mit_smile_listed: true,
      ...(cert ? { mit_smile_cert: cert } : {}),
      verified_source: 'mit_smile_registry',
      verified_by: reviewerId,
    })
  )
}

export async function verifyMitByCert(
  brandId: string,
  certNumber: string
): Promise<{ data?: unknown; error?: string }> {
  if (!certNumber) {
    return { error: 'cert_required' }
  }

  const registryRecord = await lookupCertNumber(certNumber)
  if (!registryRecord) {
    return { error: 'cert_not_found' }
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brands')
    .update({
      mit_status: 'verified',
      mit_verified_at: new Date().toISOString(),
      mit_evidence: {
        mit_smile_listed: true,
        mit_smile_cert: certNumber,
        verified_source: 'mit_registry_auto',
      },
    })
    .eq('id', brandId)
    .select(BRAND_SELECT)
    .single()

  if (error || !data) {
    throw new NotFoundError('Brand', brandId, { cause: error })
  }

  return { data }
}
