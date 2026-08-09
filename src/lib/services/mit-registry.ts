import { auditedCall } from '@/lib/audit'
import { createServiceClient } from '@/lib/supabase/service'
import AdmZip from 'adm-zip'

export type MitRegistryRecord = {
  cert_number: string
  company_name: string | null
  brand_name: string | null
  product_name: string | null
  product_model: string | null
  industry_type: string | null
  valid_until: string | null
}

/**
 * Parse a single CSV line following RFC 4180: fields may be wrapped in double
 * quotes, and a literal double-quote inside a quoted field is escaped as "".
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  let i = 0

  while (i < line.length) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i += 2
        } else {
          inQuotes = false
          i++
        }
      } else {
        current += ch
        i++
      }
    } else {
      if (ch === '"') {
        inQuotes = true
        i++
      } else if (ch === ',') {
        fields.push(current)
        current = ''
        i++
      } else {
        current += ch
        i++
      }
    }
  }

  fields.push(current)
  return fields
}

function parseMitCsv(csvContent: string): MitRegistryRecord[] {
  if (!csvContent.trim()) return []

  const lines = csvContent.split('\n').filter((line) => line.trim())
  if (lines.length < 2) return []

  const headers = parseCsvLine(lines[0]).map((h) => h.trim())
  const records: MitRegistryRecord[] = []

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]).map((c) => c.trim())
    const row: Record<string, string> = {}

    headers.forEach((header, idx) => {
      row[header] = cells[idx] ?? ''
    })

    const certNumber = row['標章編號'] ?? ''
    if (!certNumber) continue

    records.push({
      cert_number: certNumber,
      company_name: row['獲證業者'] || null,
      brand_name: row['品牌名稱'] || null,
      product_name: row['產品名稱'] || null,
      product_model: row['產品型號'] || null,
      industry_type: row['產業別'] || null,
      valid_until: row['產品效期'] || null,
    })
  }

  return records
}

async function queryCertNumbers(
  normalizedCertNumbers: string[],
): Promise<Map<string, MitRegistryRecord>> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('mit_registry')
    .select('*')
    .in('cert_number', normalizedCertNumbers)

  if (error) throw error

  return new Map(
    (data ?? []).map((record) => {
      const typedRecord = record as MitRegistryRecord
      return [typedRecord.cert_number, typedRecord]
    })
  )
}

function classifyRegistryLookup(result: Map<string, MitRegistryRecord>) {
  return result.size === 0 ? 'empty' as const : 'succeeded' as const
}

export async function lookupCertNumber(certNumber: string): Promise<MitRegistryRecord | null> {
  const normalizedCertNumber = certNumber.trim()
  if (!normalizedCertNumber) return null

  const records = await auditedCall(
    { provider: 'mit-registry', operation: 'lookup_cert_number', kind: 'external' },
    () => queryCertNumbers([normalizedCertNumber]),
    {
      classify: classifyRegistryLookup,
      summary: { count: 1, certNumbers: [normalizedCertNumber] },
    },
  )
  return records.get(normalizedCertNumber) ?? null
}

export async function lookupCertNumbers(
  certNumbers: string[]
): Promise<Map<string, MitRegistryRecord>> {
  const normalizedCertNumbers = [...new Set(certNumbers.map((certNumber) => certNumber.trim()))].filter(
    Boolean
  )
  if (normalizedCertNumbers.length === 0) return new Map()

  return auditedCall(
    { provider: 'mit-registry', operation: 'lookup_cert_numbers', kind: 'external' },
    () => queryCertNumbers(normalizedCertNumbers),
    {
      classify: classifyRegistryLookup,
      summary: { count: normalizedCertNumbers.length, certNumbers: normalizedCertNumbers },
    },
  )
}

const MIT_ZIP_URL = 'https://keid.nat.gov.tw/mittw/Files/Download/productlist.zip'
const CSV_FILENAME = '011.csv'
const BATCH_SIZE = 500

/**
 * Fraction of the existing registry a sync must re-supply before its
 * mark-and-sweep is allowed to delete the rows it did not touch.
 *
 * The upstream dataset is a full weekly republish, so a healthy sync always
 * carries ~100% of the current rows. A payload that carries materially less is
 * a truncated download or a changed file layout, not 20% of Taiwan's MIT
 * certifications being revoked in one week. Sweeping on that input would wipe
 * the registry and silently downgrade every auto-verified brand.
 */
export const MIN_SWEEP_COVERAGE_RATIO = 0.8

/**
 * Decide whether this sync's payload is complete enough to delete the rows it
 * did not re-supply. An empty table has nothing to protect, so the first
 * populating sync always sweeps.
 */
export function shouldSweepStaleRecords(parsedCount: number, existingCount: number): boolean {
  if (existingCount === 0) return true
  return parsedCount >= existingCount * MIN_SWEEP_COVERAGE_RATIO
}

export async function syncMitRegistry(): Promise<{
  recordCount: number
  durationMs: number
  sweptStale: boolean
}> {
  const startMs = Date.now()

  const syncSummary: Record<string, unknown> = { recordCount: 0 }
  const { records } = await auditedCall(
    { provider: 'mit-registry', operation: 'sync_registry', kind: 'external' },
    async () => {
      const response = await fetch(MIT_ZIP_URL)
      if (!response.ok) {
        throw new Error(`Failed to fetch MIT registry ZIP: ${response.status} ${response.statusText}`)
      }

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      const zip = new AdmZip(buffer)
      const entry = zip.getEntry(CSV_FILENAME)
      if (!entry) {
        throw new Error(`CSV file "${CSV_FILENAME}" not found in ZIP archive`)
      }

      const csvContent = entry.getData().toString('utf-8')
      const records = parseMitCsv(csvContent)
      syncSummary.recordCount = records.length
      return { records }
    },
    {
      classify: (result) => result.records.length === 0 ? 'empty' : 'succeeded',
      summary: { result: syncSummary },
    },
  )

  const supabase = createServiceClient()
  const syncedAt = new Date(startMs).toISOString()

  // Read the pre-sync size before upserting — afterwards the count includes
  // this payload's own rows and the coverage check compares against itself.
  const { count: existingCount, error: countError } = await supabase
    .from('mit_registry')
    .select('cert_number', { count: 'exact', head: true })

  if (countError) throw countError

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE).map((r) => ({
      ...r,
      synced_at: syncedAt,
    }))
    const { error } = await supabase
      .from('mit_registry')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(batch as any[], { onConflict: 'cert_number' })

    if (error) throw error
  }

  // Remove records that were not part of this sync — they have been revoked
  // or are no longer in the official dataset. Skipped when the payload is too
  // small to be a full republish: the upserts above are still kept (they are
  // additive and safe), only the destructive half is withheld.
  const sweptStale = shouldSweepStaleRecords(records.length, existingCount ?? 0)

  if (sweptStale) {
    const { error: cleanupError } = await supabase
      .from('mit_registry')
      .delete()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .lt('synced_at' as any, syncedAt)

    if (cleanupError) throw cleanupError
  }

  return {
    recordCount: records.length,
    durationMs: Date.now() - startMs,
    sweptStale,
  }
}
