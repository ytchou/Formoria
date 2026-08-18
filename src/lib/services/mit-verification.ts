import { NotFoundError } from '@/lib/errors'
import { auditedCall } from '@/lib/audit'
import { createServiceClient } from '@/lib/supabase/service'
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

/**
 * Whether a registry `valid_until` is still in the future (DEV-1475).
 *
 * `mit_registry.valid_until` holds the government's `產品效期` VERBATIM, which
 * is `yyyymmdd` — every one of the archive's 245,135 rows, with no second
 * format. `new Date('20120127')` is an Invalid Date, so the guard that used to
 * live inline here (`!isNaN(...) && expiry < now`) skipped its own check on
 * every row it was written to catch, and an expired certificate auto-verified a
 * brand. It stayed invisible while the mirror held one of 26 industry files;
 * widening the sync takes the expired population from ~28,000 to ~214,000, so
 * the parse has to be right before the rows land.
 *
 * A value that is NOT `yyyymmdd` returns false — refusing to verify. This is a
 * public trust label, so an expiry nobody can read is not evidence of a live
 * certificate. Nothing upstream is shaped that way today; if that changes, this
 * fails toward "unverified", which is the recoverable direction.
 */
export function isMitCertUnexpired(validUntil: string, now: Date = new Date()): boolean {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(validUntil.trim())
  if (!match) return false

  // UTC, and the END of the stated day: the certificate is valid THROUGH its
  // expiry date, and a local-time parse would retire it up to a day early for
  // anyone west of Taipei.
  const expiryMs = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1)
  return now.getTime() < expiryMs
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

  if (registryRecord.valid_until && !isMitCertUnexpired(registryRecord.valid_until)) {
    return { error: 'cert_expired' }
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
