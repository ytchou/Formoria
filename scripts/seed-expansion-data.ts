import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

type ProvenanceSource = {
  url: string
  title: string
  retrievedAt: string
}

type ReputationSummary = {
  text: string
  sources: ProvenanceSource[]
  retrievedAt: string
}

type Manufacturing = {
  factoryLocation: string | null
  productionModel: 'own' | 'oem' | 'mixed' | null
  notes: string | null
  sources: ProvenanceSource[]
}

type Certification = {
  name: string
  issuer: string | null
  year: number | null
  source: ProvenanceSource | null
}

type Policies = {
  returns: string | null
  warranty: string | null
  shipsInternational: boolean | null
  sources: ProvenanceSource[]
}

/**
 * ChatGPT prompt for generating enrichment expansion seed data
 *
 * Use this prompt for a batch of brands. Replace the brand list with the target slugs and names.
 *
 * Prompt:
 * You are researching brand enrichment data for a product directory.
 * For each brand in the list, research and return only a JSON array that matches this schema:
 *
 * interface SeedEntry {
 *   slug: string
 *   reputationSummary?: ReputationSummary | null
 *   manufacturing?: Manufacturing | null
 *   certifications?: Certification[] | null
 *   policies?: Policies | null
 * }
 *
 * Research requirements:
 * - reputationSummary: summarize public reputation, media coverage, customer sentiment, or notable positioning
 * - manufacturing: identify factory location and manufacturing model when evidence exists
 * - certifications: list third-party certifications with issuer and year when evidence exists
 * - policies: summarize return/shipping/warranty policies when evidence exists
 * - include source URLs for every evidence-backed field
 * - use null when evidence is insufficient
 * - do not guess or invent details
 *
 * Provenance requirements:
 * - Every sources[] item must include url, title, and retrievedAt
 * - sources[].url must be a non-empty URL string
 * - retrievedAt must be an ISO date string
 *
 * Output rules:
 * - Return JSON only, no markdown, no commentary
 * - Return an array of SeedEntry objects
 * - Keep slugs exactly as provided
 *
 * Example output:
 * [
 *   {
 *     "slug": "example-brand",
 *     "reputationSummary": {
 *       "text": "Known for durable everyday goods and strong design reviews.",
 *       "sources": [
 *         {
 *           "url": "https://example.com/review",
 *           "title": "Example review",
 *           "retrievedAt": "2026-07-03T00:00:00.000Z"
 *         }
 *       ],
 *       "retrievedAt": "2026-07-03T00:00:00.000Z"
 *     },
 *     "manufacturing": null,
 *     "certifications": null,
 *     "policies": null
 *   }
 * ]
 *
 * Run:
 * pnpm tsx scripts/seed-expansion-data.ts --file data.json --dry-run
 */

type SeedEntry = {
  slug: string
  reputationSummary?: ReputationSummary | null
  manufacturing?: Manufacturing | null
  certifications?: Certification[] | null
  policies?: Policies | null
}

type CliArgs = {
  file: string
  dryRun: boolean
  overwrite: boolean
}

type BrandExpansionRow = {
  slug: string
  reputation_summary: ReputationSummary | null
  manufacturing: Manufacturing | null
  certifications: Certification[] | null
  policies: Policies | null
}

type Summary = {
  seeded: number
  skipped: number
  errors: number
}

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  return createSupabaseClient(url, serviceRoleKey)
}

function printUsage(): void {
  console.log('Usage: pnpm tsx scripts/seed-expansion-data.ts --file <path> [--dry-run] [--overwrite]')
}

function parseStringFlag(args: string[], name: string): string | undefined {
  const flag = `--${name}`
  const equalsArg = args.find((arg) => arg.startsWith(`${flag}=`))
  const rawValue = equalsArg?.slice(flag.length + 1)

  if (rawValue === undefined) {
    const index = args.indexOf(flag)
    const nextValue = index >= 0 ? args[index + 1] : undefined

    if (!nextValue || nextValue.startsWith('--')) {
      return undefined
    }

    return nextValue.trim() || undefined
  }

  return rawValue.trim() || undefined
}

function parseArgs(argv: string[]): CliArgs {
  const dryRun = argv.includes('--dry-run')
  const overwrite = argv.includes('--overwrite')
  const file = parseStringFlag(argv, 'file')

  if (!file) {
    throw new Error('Missing required --file <path>')
  }

  return { file, dryRun, overwrite }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isIsoDateString(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false
  const parsed = Date.parse(value)
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value
}

function parseProvenanceSources(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false

  return value.every((item) => {
    if (!item || typeof item !== 'object') return false
    const source = item as Record<string, unknown>
    return isNonEmptyString(source.url) && isNonEmptyString(source.title) && isIsoDateString(source.retrievedAt)
  })
}

function isValidReputationSummary(value: unknown): value is ReputationSummary {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return isNonEmptyString(item.text) && isIsoDateString(item.retrievedAt) && parseProvenanceSources(item.sources)
}

function isValidManufacturing(value: unknown): value is Manufacturing {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  const productionModel = item.productionModel
  const validProductionModel =
    productionModel === null ||
    productionModel === 'own' ||
    productionModel === 'oem' ||
    productionModel === 'mixed'

  return (
    validProductionModel &&
    (item.factoryLocation === null || isNonEmptyString(item.factoryLocation)) &&
    (item.notes === null || isNonEmptyString(item.notes)) &&
    parseProvenanceSources(item.sources)
  )
}

function isValidCertification(value: unknown): value is Certification {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>

  return (
    isNonEmptyString(item.name) &&
    (item.issuer === null || isNonEmptyString(item.issuer)) &&
    (item.year === null || (typeof item.year === 'number' && Number.isInteger(item.year))) &&
    (item.source === null ||
      (typeof item.source === 'object' &&
        item.source !== null &&
        isNonEmptyString((item.source as Record<string, unknown>).url) &&
        isNonEmptyString((item.source as Record<string, unknown>).title) &&
        isIsoDateString((item.source as Record<string, unknown>).retrievedAt)))
  )
}

function isValidPolicies(value: unknown): value is Policies {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>

  return (
    (item.returns === null || isNonEmptyString(item.returns)) &&
    (item.warranty === null || isNonEmptyString(item.warranty)) &&
    (item.shipsInternational === null || typeof item.shipsInternational === 'boolean') &&
    parseProvenanceSources(item.sources)
  )
}

function isValidEntry(value: unknown): value is SeedEntry {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>

  if (!isNonEmptyString(item.slug)) return false
  if (item.reputationSummary !== undefined && item.reputationSummary !== null && !isValidReputationSummary(item.reputationSummary)) {
    return false
  }
  if (item.manufacturing !== undefined && item.manufacturing !== null && !isValidManufacturing(item.manufacturing)) {
    return false
  }
  if (item.certifications !== undefined && item.certifications !== null) {
    if (!Array.isArray(item.certifications) || !item.certifications.every(isValidCertification)) return false
  }
  if (item.policies !== undefined && item.policies !== null && !isValidPolicies(item.policies)) {
    return false
  }

  return true
}

function normalizeEntry(value: SeedEntry): SeedEntry {
  return {
    slug: value.slug.trim(),
    reputationSummary: value.reputationSummary ?? null,
    manufacturing: value.manufacturing ?? null,
    certifications: value.certifications ?? null,
    policies: value.policies ?? null,
  }
}

function getExistingPatch(row: BrandExpansionRow, entry: SeedEntry, overwrite: boolean): Partial<BrandExpansionRow> {
  const patch: Partial<BrandExpansionRow> = {}

  if (entry.reputationSummary != null && (overwrite || row.reputation_summary == null)) {
    patch.reputation_summary = entry.reputationSummary
  }
  if (entry.manufacturing != null && (overwrite || row.manufacturing == null)) {
    patch.manufacturing = entry.manufacturing
  }
  if (entry.certifications != null && (overwrite || row.certifications == null)) {
    patch.certifications = entry.certifications
  }
  if (entry.policies != null && (overwrite || row.policies == null)) {
    patch.policies = entry.policies
  }

  return patch
}

async function loadEntries(filePath: string): Promise<SeedEntry[]> {
  const resolvedPath = path.resolve(filePath)
  const raw = await readFile(resolvedPath, 'utf8')
  const parsed = JSON.parse(raw) as unknown

  if (!Array.isArray(parsed)) {
    throw new Error('Input file must contain a JSON array')
  }

  return parsed
}

function logSkipped(slug: string, reason: string): void {
  console.warn(`[skip] ${slug}: ${reason}`)
}

function logDryRun(slug: string, patch: Partial<BrandExpansionRow>): void {
  console.log(`[dry-run] ${slug}: would update ${Object.keys(patch).join(', ')}`)
}

async function main(): Promise<void> {
  const summary: Summary = { seeded: 0, skipped: 0, errors: 0 }

  try {
    const args = parseArgs(process.argv.slice(2))
    const entries = await loadEntries(args.file)
    const supabase = createServiceClient()

    for (const rawEntry of entries) {
      if (!isValidEntry(rawEntry)) {
        summary.skipped += 1
        console.warn('[skip] invalid entry: failed schema/provenance validation')
        continue
      }

      const entry = normalizeEntry(rawEntry)

      const { data: brandRow, error: lookupError } = await supabase
        .from('brands')
        .select('slug, reputation_summary, manufacturing, certifications, policies')
        .eq('slug', entry.slug)
        .maybeSingle()

      if (lookupError) {
        summary.errors += 1
        console.error(`[error] ${entry.slug}: lookup failed - ${lookupError.message}`)
        continue
      }

      if (!brandRow) {
        summary.skipped += 1
        logSkipped(entry.slug, 'brand does not exist')
        continue
      }

      const patch = getExistingPatch(
        brandRow as BrandExpansionRow,
        entry,
        args.overwrite
      )

      if (Object.keys(patch).length === 0) {
        summary.skipped += 1
        logSkipped(entry.slug, args.overwrite ? 'no fields provided' : 'all target fields already populated')
        continue
      }

      if (args.dryRun) {
        summary.seeded += 1
        logDryRun(entry.slug, patch)
        continue
      }

      const { error: updateError } = await supabase
        .from('brands')
        .update(patch)
        .eq('slug', entry.slug)

      if (updateError) {
        summary.errors += 1
        console.error(`[error] ${entry.slug}: update failed - ${updateError.message}`)
        continue
      }

      summary.seeded += 1
      console.log(`[seeded] ${entry.slug}`)
    }
  } catch (error) {
    summary.errors += 1
    console.error(error instanceof Error ? error.message : String(error))
    printUsage()
  } finally {
    console.log('')
    console.log('--- Summary ---')
    console.log(`Seeded: ${summary.seeded}`)
    console.log(`Skipped: ${summary.skipped}`)
    console.log(`Errors: ${summary.errors}`)

    if (summary.errors > 0) {
      process.exitCode = 1
    }
  }
}

if (process.argv[1]?.endsWith('seed-expansion-data.ts')) {
  void main()
}
