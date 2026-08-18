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

export const MIT_REGISTRY_SYNC_MAX_AGE_HOURS = 192

export type MitRegistrySyncRow = {
  cert_number: string
  synced_at: string | null
}

export type MitRegistryHealth = {
  status: 'healthy' | 'degraded' | 'down'
  message: string
}

export function classifyMitRegistryHealth(
  rows: readonly MitRegistrySyncRow[],
  now: Date = new Date(),
): MitRegistryHealth {
  const latest = rows.at(0)
  if (!latest) {
    return { status: 'down', message: 'MIT registry mirror is empty' }
  }

  const syncedAtMs =
    typeof latest.synced_at === 'string' ? Date.parse(latest.synced_at) : Number.NaN
  if (!Number.isFinite(syncedAtMs)) {
    return { status: 'degraded', message: 'MIT registry sync timestamp is invalid' }
  }

  const ageHours = (now.getTime() - syncedAtMs) / (60 * 60 * 1000)
  if (!Number.isFinite(ageHours) || ageHours > MIT_REGISTRY_SYNC_MAX_AGE_HOURS) {
    return { status: 'degraded', message: 'MIT registry mirror is stale' }
  }

  return { status: 'healthy', message: 'MIT registry mirror is fresh' }
}

async function queryLatestMitRegistrySync(): Promise<MitRegistrySyncRow[]> {
  const { data, error } = await createServiceClient()
    .from('mit_registry')
    .select('cert_number, synced_at')
    .order('synced_at', { ascending: false })
    .limit(1)

  if (error) throw error
  return (data ?? []) as MitRegistrySyncRow[]
}

export async function checkMitRegistryHealth(): Promise<MitRegistryHealth> {
  try {
    return classifyMitRegistryHealth(await queryLatestMitRegistrySync())
  } catch {
    return { status: 'down', message: 'MIT registry query failed' }
  }
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

/**
 * One industry file to records. Exported for the archive test: all 26 data
 * files share this layout (their `schema-NN.csv` column lists are identical),
 * so this one parser is what every certificate in the registry passes through.
 */
export function parseMitCsv(csvContent: string): MitRegistryRecord[] {
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

/**
 * The archive's own index of its data files (DEV-1475).
 *
 * READ THE MANIFEST, NEVER A FILENAME. This sync used to open exactly one entry
 * — `011.csv`, the 成衣 (apparel) family — so `lookupCertNumber` could resolve
 * `011…` certificates and nothing else. 25 other industries, ~215,000 rows and
 * every non-apparel certificate were unreachable, including real ones a brand
 * had already been verified against by hand.
 *
 * `manifest.csv` maps each data file to its schema and its industry, so it is
 * the only entry that says which of the archive's 53 entries carry data: the
 * other 27 are `schema-NN.csv` column descriptions and the manifest itself. It
 * also means a new industry file is picked up the week it appears, with no
 * code change — which is the failure this whole ticket is.
 */
const MANIFEST_FILENAME = 'manifest.csv'

/**
 * Rows per upsert. Raised from 500 with the archive widening: the payload went
 * from ~29,000 rows to ~245,000, and at 500 that is ~490 sequential round trips
 * inside the route's 300s budget (`maxDuration`, matched by the pg_net timeout
 * in `20260808120000_mit_registry_sync_timeout.sql`). Halving the round trips
 * buys the margin back. Raising it further trades a fixed win for a growing
 * statement size, so measure before moving it again.
 */
const BATCH_SIZE = 1000

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
 * did not re-supply.
 *
 * THE RATIO ALONE CANNOT SEE A TRUNCATION IT INHERITED. It compares the payload
 * against the existing table, so while the sync read one of 26 files the table
 * held one file's worth of rows and every run looked like ~100% coverage. The
 * guard was measuring the truncation against itself (DEV-1475).
 *
 * So completeness is asserted against the ARCHIVE first: every file the
 * manifest lists must have yielded records. That is the condition the ratio can
 * never supply, because it is the only one that does not depend on what the
 * table already contains. The ratio still runs afterwards, where it is sound —
 * catching a week-over-week collapse once the baseline is the whole dataset.
 */
export function shouldSweepStaleRecords(input: {
  parsedCount: number
  existingCount: number
  /** Data files `manifest.csv` listed. */
  expectedFileCount: number
  /** Of those, how many yielded at least one record. */
  parsedFileCount: number
}): boolean {
  const { parsedCount, existingCount, expectedFileCount, parsedFileCount } = input
  // An archive that indexed nothing is a changed upstream layout, not an empty
  // dataset — the one input where deleting everything is most tempting.
  if (expectedFileCount === 0) return false
  if (parsedFileCount < expectedFileCount) return false
  // A payload carrying no rows can never authorize a delete, table empty or not.
  if (parsedCount === 0) return false
  if (existingCount === 0) return true
  return parsedCount >= existingCount * MIN_SWEEP_COVERAGE_RATIO
}

/**
 * The data files `manifest.csv` indexes, in its own order.
 *
 * Its first column is the filename; the rest describe the schema and industry
 * and are not needed here. The BOM the government writes on every file in this
 * archive is stripped first — without it the first header parses as
 * `﻿name` and the column lookup misses, which is invisible for the data
 * files (their first column is unused) and fatal for this one.
 */
export function parseManifestFilenames(manifestCsv: string): string[] {
  const lines = manifestCsv.replace(/^﻿/, '').split('\n').filter((line) => line.trim())
  if (lines.length < 2) return []

  const headers = parseCsvLine(lines[0]).map((header) => header.trim())
  const nameIndex = headers.indexOf('name')
  if (nameIndex === -1) return []

  const names: string[] = []
  for (let i = 1; i < lines.length; i++) {
    const name = parseCsvLine(lines[i])[nameIndex]?.trim()
    // Self-reference or a schema description would parse to zero records and
    // then be counted as an unread file, blocking the sweep forever.
    if (!name || name === MANIFEST_FILENAME || name.startsWith('schema-')) continue
    names.push(name)
  }
  return names
}

/**
 * Collapses the payload to one row per certificate, keeping the latest expiry.
 *
 * `cert_number` is the table's unique key, but the upstream files carry one ROW
 * PER PRODUCT VARIANT: 826 certificates appear two or more times, differing
 * only in product name and expiry. Left as-is those duplicates reach a single
 * `ON CONFLICT DO UPDATE` statement twice, which Postgres rejects outright
 * ("cannot affect row a second time") and which fails the whole batch — today
 * they merely happen to land in different 500-row batches, which is luck, not
 * design.
 *
 * LATEST EXPIRY WINS, not last-seen: a certificate is live until the last of
 * its products expires, and file order is arbitrary. `valid_until` is `yyyymmdd`
 * throughout this dataset, so a string comparison is a date comparison.
 */
export function dedupeRecordsByCert(
  records: readonly MitRegistryRecord[],
): MitRegistryRecord[] {
  const byCert = new Map<string, MitRegistryRecord>()
  for (const record of records) {
    const existing = byCert.get(record.cert_number)
    if (!existing || (record.valid_until ?? '') > (existing.valid_until ?? '')) {
      byCert.set(record.cert_number, record)
    }
  }
  return [...byCert.values()]
}

export async function syncMitRegistry(): Promise<{
  recordCount: number
  durationMs: number
  sweptStale: boolean
}> {
  const startMs = Date.now()

  const syncSummary: Record<string, unknown> = { recordCount: 0 }
  const { records, expectedFileCount, parsedFileCount } = await auditedCall(
    { provider: 'mit-registry', operation: 'sync_registry', kind: 'external' },
    async () => {
      const response = await fetch(MIT_ZIP_URL)
      if (!response.ok) {
        throw new Error(`Failed to fetch MIT registry ZIP: ${response.status} ${response.statusText}`)
      }

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      const zip = new AdmZip(buffer)
      const manifestEntry = zip.getEntry(MANIFEST_FILENAME)
      if (!manifestEntry) {
        throw new Error(`"${MANIFEST_FILENAME}" not found in ZIP archive`)
      }

      const filenames = parseManifestFilenames(manifestEntry.getData().toString('utf-8'))
      if (filenames.length === 0) {
        throw new Error(`"${MANIFEST_FILENAME}" listed no data files`)
      }

      // Every file is read. A missing or empty one is REPORTED rather than
      // thrown on: one industry the government publishes late must not cost the
      // other 25 their weekly refresh. It does withhold the sweep, because a
      // partial archive cannot authorize deleting the rows it failed to carry.
      const parsed: MitRegistryRecord[] = []
      const skipped: string[] = []
      let parsedFileCount = 0
      for (const filename of filenames) {
        const entry = zip.getEntry(filename)
        if (!entry) {
          skipped.push(filename)
          continue
        }
        const fileRecords = parseMitCsv(entry.getData().toString('utf-8'))
        if (fileRecords.length === 0) {
          skipped.push(filename)
          continue
        }
        parsedFileCount += 1
        parsed.push(...fileRecords)
      }

      const records = dedupeRecordsByCert(parsed)
      syncSummary.recordCount = records.length
      syncSummary.rowCount = parsed.length
      syncSummary.expectedFileCount = filenames.length
      syncSummary.parsedFileCount = parsedFileCount
      syncSummary.skippedFiles = skipped
      return { records, expectedFileCount: filenames.length, parsedFileCount }
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
  const sweptStale = shouldSweepStaleRecords({
    parsedCount: records.length,
    existingCount: existingCount ?? 0,
    expectedFileCount,
    parsedFileCount,
  })

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
