import { NotFoundError } from '@/lib/errors'
import { createServiceClient } from '@/lib/supabase/server'
import { BRAND_SELECT } from './brands'
import { lookupCertNumber } from '@/lib/services/mit-registry'

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

  if (registryRecord.valid_until) {
    const expiryDate = new Date(registryRecord.valid_until)
    if (!isNaN(expiryDate.getTime()) && expiryDate < new Date()) {
      return { error: 'cert_expired' }
    }
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
