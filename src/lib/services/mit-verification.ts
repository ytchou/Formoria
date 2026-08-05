import { NotFoundError } from '@/lib/errors'
import { auditedCall } from '@/lib/audit'
import { createServiceClient } from '@/lib/supabase/server'
import { BRAND_SELECT } from './brands'
import { lookupCertNumber } from '@/lib/services/mit-registry'

const LEGAL_ENTITY_SUFFIX_PATTERN = /(?:股份有限公司|有限責任公司|有限公司)$/u

function normalizeMitIdentity(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('zh-TW')
    .replace(LEGAL_ENTITY_SUFFIX_PATTERN, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

export async function verifyMitByCert(
  brandId: string,
  certNumber: string
): Promise<{ data?: unknown; error?: string }> {
  return auditedCall(
    { provider: 'brands', operation: 'verifyMitByCert', kind: 'service' },
    async () => {
  const normalizedCertNumber = certNumber.trim()
  if (!normalizedCertNumber) {
    return { error: 'cert_required' }
  }

  const registryRecord = await lookupCertNumber(normalizedCertNumber)
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
  const { data: brand, error: brandError } = await supabase
    .from('brands')
    .select('name')
    .eq('id', brandId)
    .maybeSingle()

  if (brandError || !brand) {
    throw new NotFoundError('Brand', brandId, { cause: brandError })
  }

  const normalizedBrandName = normalizeMitIdentity(brand.name)
  const normalizedRegistryNames = [registryRecord.company_name, registryRecord.brand_name]
    .filter((name): name is string => Boolean(name))
    .map(normalizeMitIdentity)
    .filter(Boolean)

  if (!normalizedRegistryNames.includes(normalizedBrandName)) {
    return { error: 'cert_mismatch' }
  }

  const { data: existingCertificate, error: existingCertificateError } = await supabase
    .from('brands')
    .select('id')
    .eq('mit_evidence->>mit_smile_cert', normalizedCertNumber)
    .neq('id', brandId)
    .limit(1)
    .maybeSingle()

  if (existingCertificateError) throw existingCertificateError
  if (existingCertificate) {
    return { error: 'cert_already_claimed' }
  }

  const { data, error } = await supabase
    .from('brands')
    .update({
      mit_status: 'verified',
      mit_verified_at: new Date().toISOString(),
      mit_evidence: {
        mit_smile_listed: true,
        mit_smile_cert: normalizedCertNumber,
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
    },
  )
}
