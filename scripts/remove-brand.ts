import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServiceClient } from '@/lib/supabase/service'
import type { Database } from '@/lib/supabase/database.types'
import { subcategoryBySlug } from '@/lib/taxonomy/ontology'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// storage-js caps a `.list()` page at 100 by default; ask for the maximum and
// page explicitly (see listStorageObjectsUnder).
const STORAGE_LIST_PAGE_SIZE = 1_000

// A missing table. PostgREST answers `PGRST205` ("Could not find the table in
// the schema cache"); the raw Postgres `42P01` only reaches us through an RPC or
// direct SQL path. Matching solely on `42P01` made this guard dead code and made
// brand removal fail hard on every pre-migration environment.
const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01'])

function isMissingTableError(error: { code?: string | null } | null): boolean {
  return Boolean(error?.code && MISSING_TABLE_CODES.has(error.code))
}

// ---------------------------------------------------------------------------
// Minimal inline types for rows we handle (avoids guessing re-exports)
// ---------------------------------------------------------------------------

type BrandRow = Database['public']['Tables']['brands']['Row']
type BrandSubmissionRow = Database['public']['Tables']['brand_submissions']['Row']
// The service client is deliberately untyped here because old backup rows can
// carry the retired plural key. Its children cascade, so only the parent row
// needs enumerating.
type CuratedProductRow = Record<string, unknown> & { id: string }

// Explicit column list for the backup snapshot. The restore path re-inserts the
// row verbatim, so this must stay the full parent-row column set — but spelled
// out, so a column rename breaks the fetch loudly instead of silently changing
// the snapshot shape. An ADDED column is the silent direction — it drops out of
// the snapshot and the restore re-inserts an incomplete row without erroring —
// so the list is pinned against the generated row type by
// scripts/remove-brand-columns.test.ts rather than by convention.
//
// One `as const` literal, no spaces after commas: supabase-js parses the select
// string at the type level, and a runtime-joined `string[]` resolves to
// `GenericStringError[]` instead of a row type.
const CURATED_PRODUCT_COLUMNS =
  'id,brand_id,key,name_zh,name_en,category,subcategory,material,official_url,image_url,image_source_url,link_state,link_checked_at,source_checked_at,review_due_at,created_at,updated_at,proposed_by,image_width,image_height,product_description_zh,product_description_en,product_position,visible,made_in_taiwan_confirmed,materials_from_taiwan_confirmed,mit_registry_id,origin_candidate_id' as const

export function adaptCuratedProductBackupRow(
  row: CuratedProductRow,
): CuratedProductRow {
  if (!('subcategories' in row)) return row
  const { subcategories, ...current } = row
  const values = Array.isArray(subcategories) ? subcategories : []
  const candidate =
    values.length === 1 && typeof values[0] === 'string'
      ? subcategoryBySlug(values[0])
      : null
  const compatible =
    candidate && candidate.category === row.category ? candidate.slug : null
  return {
    ...current,
    subcategory: compatible,
    visible: compatible ? row.visible : false,
  }
}

type BackupEntry = {
  brand: BrandRow
  submissions: BrandSubmissionRow[]
  // Optional: backups written before DEV-1404 have no curated products.
  curatedProducts?: CuratedProductRow[]
  storagePaths: string[]
}

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

type CliOptions =
  | { mode: 'remove'; slugs: string[]; dryRun: boolean }
  | { mode: 'restore'; restorePath: string }

function printUsage(): void {
  console.error(
    [
      'Usage:',
      '  Remove:  --slug=a,b,c [--dry-run]',
      '           --file=slugs.txt [--dry-run]',
      '  Restore: --restore=path/to/backup.json',
    ].join('\n')
  )
}

function parseArgs(argv: string[]): CliOptions {
  let rawSlugs: string | null = null
  let filePath: string | null = null
  let restorePath: string | null = null
  let dryRun = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (arg === '--dry-run') {
      dryRun = true
    } else if (arg.startsWith('--slug=')) {
      rawSlugs = arg.slice('--slug='.length)
    } else if (arg === '--slug') {
      rawSlugs = argv[i + 1] ?? ''
      i++
    } else if (arg.startsWith('--file=')) {
      filePath = arg.slice('--file='.length)
    } else if (arg === '--file') {
      filePath = argv[i + 1] ?? ''
      i++
    } else if (arg.startsWith('--restore=')) {
      restorePath = arg.slice('--restore='.length)
    } else if (arg === '--restore') {
      restorePath = argv[i + 1] ?? ''
      i++
    } else {
      console.error(`Unknown argument: ${arg}`)
      printUsage()
      process.exit(1)
    }
  }

  // --restore is mutually exclusive with all delete args
  if (restorePath !== null) {
    if (rawSlugs !== null || filePath !== null || dryRun) {
      console.error('--restore is mutually exclusive with --slug, --file, and --dry-run')
      printUsage()
      process.exit(1)
    }
    if (restorePath === '') {
      console.error('--restore requires a path')
      process.exit(1)
    }
    return { mode: 'restore', restorePath }
  }

  // Remove mode — require at least one source
  if (rawSlugs === null && filePath === null) {
    console.error('Provide --slug or --file (or --restore to restore a backup)')
    printUsage()
    process.exit(1)
  }

  const slugSet = new Set<string>()

  if (rawSlugs !== null) {
    if (rawSlugs === '') {
      console.error('--slug requires a value')
      process.exit(1)
    }
    for (const s of rawSlugs.split(',')) {
      const trimmed = s.trim()
      if (trimmed) slugSet.add(trimmed)
    }
  }

  if (filePath !== null) {
    if (filePath === '') {
      console.error('--file requires a path')
      process.exit(1)
    }
    // Synchronous read so we can exit early; readFileSync is fine in a CLI script
    let content: string
    try {
      content = readFileSync(filePath, 'utf8')
    } catch (err) {
      console.error(`Cannot read --file: ${filePath} — ${String(err)}`)
      process.exit(1)
    }
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#')) slugSet.add(trimmed)
    }
  }

  const slugs = [...slugSet]
  if (slugs.length === 0) {
    console.error('No slugs resolved from --slug / --file')
    process.exit(1)
  }

  return { mode: 'remove', slugs, dryRun }
}

// ---------------------------------------------------------------------------
// Backup helpers
// ---------------------------------------------------------------------------

function backupFilePath(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.join('scripts', `.remove-backup-${timestamp}.json`)
}

async function writeBackup(entries: BackupEntry[]): Promise<string> {
  const outputPath = backupFilePath()
  await writeFile(outputPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8')
  return outputPath
}

function parseBackupJson(raw: string): BackupEntry[] {
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error('Backup file must contain an array')
  }
  return parsed as BackupEntry[]
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

/**
 * Lists every object under `prefix`, descending into folder entries. Curated
 * product keys are `curated-products/<brand-id>/<product-id>/<hash>.webp`, so a
 * flat listing of the brand folder returns only product folders, never objects.
 *
 * Paged, because storage-js defaults to 100 entries per call: an unpaged
 * `.list()` truncates at EVERY level of the recursion, and the objects it misses
 * survive the removal as permanent orphans that nothing can identify afterwards
 * (the rows that referenced them are gone). The endpoint may also cap a page
 * below the requested `limit`, so a short page is not the end of the listing —
 * terminate only on an empty page and advance by the actual page length.
 */
async function listStorageObjectsUnder(
  supabase: ReturnType<typeof createServiceClient>,
  prefix: string
): Promise<string[]> {
  const paths: string[] = []

  for (let offset = 0; ; ) {
    const { data, error } = await supabase.storage
      .from('brand-images')
      .list(prefix, {
        limit: STORAGE_LIST_PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      })
    if (error) {
      // Non-fatal — log and treat as empty
      console.error(`[ERROR] Storage list failed for ${prefix}: ${error.message}`)
      return paths
    }

    const page = data ?? []
    if (page.length === 0) break
    offset += page.length

    for (const entry of page) {
      const entryPath = `${prefix}/${entry.name}`
      if (entry.id === null) {
        paths.push(...(await listStorageObjectsUnder(supabase, entryPath)))
      } else {
        paths.push(entryPath)
      }
    }
  }

  return paths
}

async function listStorageObjects(
  supabase: ReturnType<typeof createServiceClient>,
  brandId: string
): Promise<string[]> {
  // Brand-scoped only because both key layouts put the brand ID first.
  const prefixes = [`brands/${brandId}`, `curated-products/${brandId}`]
  const listings = await Promise.all(
    prefixes.map((prefix) => listStorageObjectsUnder(supabase, prefix))
  )
  return listings.flat()
}

async function deleteStorageObjects(
  supabase: ReturnType<typeof createServiceClient>,
  paths: string[]
): Promise<void> {
  if (paths.length === 0) return
  const { error } = await supabase.storage.from('brand-images').remove(paths)
  if (error) {
    throw new Error(`Storage delete failed: ${error.message}`)
  }
}

// ---------------------------------------------------------------------------
// Gather step (used by both dry-run and real run)
// ---------------------------------------------------------------------------

type GatheredBrand = {
  row: BrandRow
  submissions: BrandSubmissionRow[]
  curatedProducts: CuratedProductRow[]
  storagePaths: string[]
}

async function gatherBrandData(
  supabase: ReturnType<typeof createServiceClient>,
  slug: string
): Promise<GatheredBrand | null> {
  const { data: brandRow, error: brandErr } = await supabase
    .from('brands')
    .select('*')
    .eq('slug', slug)
    .maybeSingle()

  if (brandErr) throw new Error(`DB lookup failed for slug "${slug}": ${brandErr.message}`)
  if (!brandRow) return null

  const brandId = brandRow.id

  const [submissionsResult, curatedProductsResult, storagePaths] = await Promise.all([
    supabase.from('brand_submissions').select('*').eq('brand_id', brandId),
    supabase.from('curated_products').select(CURATED_PRODUCT_COLUMNS).eq('brand_id', brandId),
    listStorageObjects(supabase, brandId),
  ])

  if (submissionsResult.error)
    throw new Error(`Submissions fetch failed for "${slug}": ${submissionsResult.error.message}`)

  // The `curated_products` migration ships with DEV-1404, so an environment
  // behind on migrations must still be able to remove a brand.
  if (
    curatedProductsResult.error &&
    !isMissingTableError(curatedProductsResult.error)
  )
    throw new Error(
      `Curated products fetch failed for "${slug}": ${curatedProductsResult.error.message}`
    )

  return {
    row: brandRow,
    submissions: submissionsResult.data ?? [],
    curatedProducts: (curatedProductsResult.data ?? []) as CuratedProductRow[],
    storagePaths,
  }
}

// ---------------------------------------------------------------------------
// Dry-run flow
// ---------------------------------------------------------------------------

async function runDryRun(
  supabase: ReturnType<typeof createServiceClient>,
  slugs: string[]
): Promise<void> {
  console.log('--- Dry Run Preview ---')

  let totalSubmissions = 0
  let totalCuratedProducts = 0
  let totalStorageObjects = 0
  let skipped = 0

  for (const slug of slugs) {
    let gathered: GatheredBrand | null
    try {
      gathered = await gatherBrandData(supabase, slug)
    } catch (err) {
      console.log(`[ERROR] ${slug} — ${String(err)}`)
      continue
    }

    if (!gathered) {
      console.log(`[SKIP]  ${slug} — not found`)
      skipped++
      continue
    }

    const { row, submissions, curatedProducts, storagePaths } = gathered
    console.log(
      `[DRY RUN] ${slug} | ${row.name} | status:${row.status} | ` +
        `submissions:${submissions.length} | ` +
        `curatedProducts:${curatedProducts.length} | ` +
        `storageObjects:${storagePaths.length}`
    )

    totalSubmissions += submissions.length
    totalCuratedProducts += curatedProducts.length
    totalStorageObjects += storagePaths.length
  }

  console.log('\n--- Dry Run Totals ---')
  console.log(`Brands to remove: ${slugs.length - skipped}`)
  console.log(`Brands not found: ${skipped}`)
  console.log(`Total brand_submissions rows: ${totalSubmissions}`)
  console.log(`Total curated_products rows: ${totalCuratedProducts}`)
  console.log(`Total Storage objects: ${totalStorageObjects}`)
  console.log('\nDry run complete. No changes made.')
}

// ---------------------------------------------------------------------------
// Real deletion flow
// ---------------------------------------------------------------------------

async function removeBrands(
  supabase: ReturnType<typeof createServiceClient>,
  slugs: string[]
): Promise<void> {
  // Phase 1: gather all data first
  const gathered: Array<GatheredBrand & { slug: string }> = []
  const notFound: string[] = []

  for (const slug of slugs) {
    let result: GatheredBrand | null
    try {
      result = await gatherBrandData(supabase, slug)
    } catch (err) {
      console.log(`[ERROR] ${slug} — gather failed: ${String(err)}`)
      continue
    }

    if (!result) {
      console.log(`[SKIP]  ${slug} — not found`)
      notFound.push(slug)
      continue
    }

    gathered.push({ ...result, slug })
  }

  if (gathered.length === 0) {
    console.log('\nNothing to remove.')
    return
  }

  // Phase 2: write backup BEFORE any mutations
  const backupEntries: BackupEntry[] = gathered.map(
    ({ row, submissions, curatedProducts, storagePaths }) => ({
      brand: row,
      submissions,
      curatedProducts,
      storagePaths,
    })
  )

  let backupPath: string
  try {
    backupPath = await writeBackup(backupEntries)
    console.log(`Backup written: ${backupPath}`)
  } catch (err) {
    console.error(`[FATAL] Backup write failed — aborting before any deletion: ${String(err)}`)
    process.exit(1)
  }

  // Phase 3: delete each brand
  let removed = 0
  let errored = 0
  let totalStorageDeleted = 0
  let totalSubmissionsDeleted = 0
  let totalCuratedProductsDeleted = 0

  for (const { slug, row, submissions, curatedProducts, storagePaths } of gathered) {
    const brandId = row.id
    try {
      // 3b. Delete Storage objects
      if (storagePaths.length > 0) {
        await deleteStorageObjects(supabase, storagePaths)
      }

      // 3b-ii. Delete curated_products. The brand FK cascades, so this is
      // belt-and-braces ordering that keeps the backup and the DB in step even
      // if the brand delete below fails; its own children cascade from here.
      if (curatedProducts.length > 0) {
        const { error: curatedErr } = await supabase
          .from('curated_products')
          .delete()
          .eq('brand_id', brandId)
        if (curatedErr)
          throw new Error(`curated_products delete failed: ${curatedErr.message}`)
      }

      // 3c. Delete brand_submissions (blocks CASCADE-less FK)
      if (submissions.length > 0) {
        const { error: subErr } = await supabase
          .from('brand_submissions')
          .delete()
          .eq('brand_id', brandId)
        if (subErr)
          throw new Error(`brand_submissions delete failed: ${subErr.message}`)
      }

      // 3d. Delete the brand row (CASCADE removes taxonomy/owners/flags/claims/analytics/reports/link_clicks)
      const { error: brandDeleteErr } = await supabase
        .from('brands')
        .delete()
        .eq('id', brandId)
      if (brandDeleteErr)
        throw new Error(`brands delete failed: ${brandDeleteErr.message}`)

      // 3e. Confirm gone
      const { data: gone } = await supabase
        .from('brands')
        .select('id')
        .eq('id', brandId)
        .maybeSingle()
      if (gone !== null) {
        throw new Error('brand row still present after delete — check DB constraints')
      }

      console.log(
        `[OK] ${slug} removed (storage:${storagePaths.length}, submissions:${submissions.length}, ` +
          `curatedProducts:${curatedProducts.length})`
      )
      removed++
      totalStorageDeleted += storagePaths.length
      totalSubmissionsDeleted += submissions.length
      totalCuratedProductsDeleted += curatedProducts.length
    } catch (err) {
      console.log(`[ERROR] ${slug} — ${String(err)}`)
      errored++
    }
  }

  console.log('\n--- Removal Summary ---')
  console.log(`Brands removed:      ${removed}`)
  console.log(`Brands not found:    ${notFound.length}`)
  console.log(`Brands errored:      ${errored}`)
  console.log(`Storage objects del: ${totalStorageDeleted}`)
  console.log(`Submissions deleted: ${totalSubmissionsDeleted}`)
  console.log(`Curated products del: ${totalCuratedProductsDeleted}`)
  console.log(`Backup file:         ${backupPath!}`)
}

// ---------------------------------------------------------------------------
// Restore flow
// ---------------------------------------------------------------------------

async function restoreBackup(
  supabase: ReturnType<typeof createServiceClient>,
  restorePath: string
): Promise<void> {
  let raw: string
  try {
    raw = await readFile(restorePath, 'utf8')
  } catch (err) {
    console.error(`Cannot read backup file: ${restorePath} — ${String(err)}`)
    process.exit(1)
  }

  let entries: BackupEntry[]
  try {
    entries = parseBackupJson(raw)
  } catch (err) {
    console.error(`Invalid backup JSON: ${String(err)}`)
    process.exit(1)
  }

  console.log(`Restoring ${entries.length} brand(s) from ${restorePath}`)
  console.log('Note: Storage files are NOT restored — only DB rows.')

  let restored = 0
  let skipped = 0

  for (const { brand, submissions, curatedProducts } of entries) {
    const slug = brand.slug

    // Check if brand already exists
    const { data: existing } = await supabase
      .from('brands')
      .select('id')
      .eq('id', brand.id)
      .maybeSingle()

    if (existing !== null) {
      console.log(`[SKIP]  ${slug} — already exists (id: ${brand.id})`)
      skipped++
      continue
    }

    try {
      // Insert brand row
      const { error: insertErr } = await supabase.from('brands').insert(brand)
      if (insertErr) throw new Error(`brands insert failed: ${insertErr.message}`)

      // Insert submissions rows
      if (submissions.length > 0) {
        const { error: subErr } = await supabase.from('brand_submissions').insert(submissions)
        if (subErr) throw new Error(`brand_submissions insert failed: ${subErr.message}`)
      }

      // Insert curated_products rows. Only the parent rows were backed up —
      // their sources and selections cascaded away and cannot be recovered,
      // exactly like the storage objects noted above.
      if (curatedProducts && curatedProducts.length > 0) {
        const { error: curatedErr } = await supabase
          .from('curated_products')
          .insert(curatedProducts.map(adaptCuratedProductBackupRow))
        if (curatedErr)
          throw new Error(`curated_products insert failed: ${curatedErr.message}`)
      }

      console.log(`[OK] ${slug} restored (db rows only — storage NOT restored)`)
      restored++
    } catch (err) {
      console.log(`[ERROR] ${slug} — ${String(err)}`)
    }
  }

  console.log('\n--- Restore Summary ---')
  console.log(`Restored: ${restored}`)
  console.log(`Skipped:  ${skipped}`)
  console.log('Storage was NOT restored — re-run backfill-images to recover image URLs if needed.')
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const supabase = createServiceClient()

  if (options.mode === 'restore') {
    await restoreBackup(supabase, options.restorePath)
    return
  }

  if (options.dryRun) {
    await runDryRun(supabase, options.slugs)
    return
  }

  await removeBrands(supabase, options.slugs)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
