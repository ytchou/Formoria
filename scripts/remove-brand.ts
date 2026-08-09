import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServiceClient } from '@/lib/supabase/service'
import type { Database } from '@/lib/supabase/database.types'

// ---------------------------------------------------------------------------
// Minimal inline types for rows we handle (avoids guessing re-exports)
// ---------------------------------------------------------------------------

type BrandRow = Database['public']['Tables']['brands']['Row']
type BrandSubmissionRow = Database['public']['Tables']['brand_submissions']['Row']

type BackupEntry = {
  brand: BrandRow
  submissions: BrandSubmissionRow[]
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

async function listStorageObjects(
  supabase: ReturnType<typeof createServiceClient>,
  brandId: string
): Promise<string[]> {
  const prefix = `brands/${brandId}`
  const { data, error } = await supabase.storage.from('brand-images').list(prefix)
  if (error) {
    // Non-fatal — log and treat as empty
    console.error(`[ERROR] Storage list failed for ${brandId}: ${error.message}`)
    return []
  }
  if (!data || data.length === 0) return []
  return data.map((obj) => `${prefix}/${obj.name}`)
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

  const [submissionsResult, storagePaths] = await Promise.all([
    supabase.from('brand_submissions').select('*').eq('brand_id', brandId),
    listStorageObjects(supabase, brandId),
  ])

  if (submissionsResult.error)
    throw new Error(`Submissions fetch failed for "${slug}": ${submissionsResult.error.message}`)

  return {
    row: brandRow,
    submissions: submissionsResult.data ?? [],
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

    const { row, submissions, storagePaths } = gathered
    console.log(
      `[DRY RUN] ${slug} | ${row.name} | status:${row.status} | ` +
        `submissions:${submissions.length} | ` +
        `storageObjects:${storagePaths.length}`
    )

    totalSubmissions += submissions.length
    totalStorageObjects += storagePaths.length
  }

  console.log('\n--- Dry Run Totals ---')
  console.log(`Brands to remove: ${slugs.length - skipped}`)
  console.log(`Brands not found: ${skipped}`)
  console.log(`Total brand_submissions rows: ${totalSubmissions}`)
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
  const backupEntries: BackupEntry[] = gathered.map(({ row, submissions, storagePaths }) => ({
    brand: row,
    submissions,
    storagePaths,
  }))

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

  for (const { slug, row, submissions, storagePaths } of gathered) {
    const brandId = row.id
    try {
      // 3b. Delete Storage objects
      if (storagePaths.length > 0) {
        await deleteStorageObjects(supabase, storagePaths)
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
        `[OK] ${slug} removed (storage:${storagePaths.length}, submissions:${submissions.length})`
      )
      removed++
      totalStorageDeleted += storagePaths.length
      totalSubmissionsDeleted += submissions.length
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

  for (const { brand, submissions } of entries) {
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

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
