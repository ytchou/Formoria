import { createServiceClient } from '@/lib/supabase/service'
import { mapWithConcurrency } from '@/lib/services/_shared/concurrency'
import { computeFocalPoint } from '@/lib/services/image-download'

/**
 * Backfill focal measurements from the stored object, never source_url: the
 * stored bytes are what render and have already passed the live path's rotate
 * and resize processing. The live write path leaves a failed measurement null
 * (never measured), while this resumable job writes 0.5/0.5 for a degenerate
 * image (measured, centred); keeping that asymmetry is what makes focal_x null
 * a reliable resume cursor.
 *
 * Dry-run is the default. Review its 3x3 histogram and degenerate count before
 * using --live. This script only updates focal columns and never mutates
 * storage objects.
 */

const PAGE_SIZE = 500
const CONCURRENCY = 4
const TABLES = ['brand_images', 'submission_images'] as const
type ImageTable = (typeof TABLES)[number]

type ImageRow = {
  id: string
  brand_id?: string | null
  storage_path: string
}

type Options = {
  live: boolean
  force: boolean
  limit: number | null
  brandId: string | null
}

function parseArgs(argv: string[]): Options {
  let live = false
  let dryRun = false
  let force = false
  let limit: number | null = null
  let brandId: string | null = null

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--live') live = true
    else if (arg === '--dry-run') dryRun = true
    else if (arg === '--force') force = true
    else if (arg === '--limit') {
      const value = Number(argv[index + 1])
      if (!Number.isSafeInteger(value) || value < 1) throw new Error('--limit requires a positive integer')
      limit = value
      index += 1
    } else if (arg === '--brand') {
      const value = argv[index + 1]
      if (!value) throw new Error('--brand requires an id')
      brandId = value
      index += 1
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (live && dryRun) throw new Error('--live is mutually exclusive with --dry-run')
  return { live, force, limit, brandId }
}

async function loadRows(
  supabase: ReturnType<typeof createServiceClient>,
  table: ImageTable,
  options: Options,
): Promise<ImageRow[]> {
  const rows: ImageRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const columns = table === 'brand_images'
      ? 'id, brand_id, storage_path, focal_x, focal_y'
      : 'id, storage_path, focal_x, focal_y'
    let query = supabase
      .from(table)
      .select(columns)
      .eq('status', 'active')
      .not('storage_path', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (!options.force) query = query.is('focal_x', null)
    if (table === 'brand_images' && options.brandId) query = query.eq('brand_id', options.brandId)

    const { data, error } = await query
    if (error) throw error
    const page = (data ?? []) as unknown as ImageRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE || (options.limit !== null && rows.length >= options.limit)) break
  }
  return options.limit === null ? rows : rows.slice(0, options.limit)
}

function bucket(value: number): number {
  return Math.min(2, Math.floor(value * 3))
}

function incrementHistogram(histogram: number[][], x: number, y: number): void {
  const row = histogram.at(bucket(y))
  if (!row) throw new Error('Focal histogram row is out of bounds')
  const column = bucket(x)
  row[column] = (row[column] ?? 0) + 1
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const supabase = createServiceClient()
  const rows: Array<{ table: ImageTable; row: ImageRow }> = []
  for (const table of TABLES) {
    // `submission_images` is keyed by `submission_id` and has no `brand_id`
    // column, so `--brand` cannot be pushed down to it. Skipping the table is
    // the only honest reading of the flag: filtering it out silently would
    // instead measure every submission image in the database on a run the
    // operator scoped to one brand.
    if (options.brandId !== null && table === 'submission_images') continue

    const remaining = options.limit === null ? null : options.limit - rows.length
    if (remaining === 0) break
    const tableRows = await loadRows(supabase, table, { ...options, limit: remaining })
    rows.push(...tableRows.map((row) => ({ table, row })))
  }
  const histogram = Array.from({ length: 3 }, () => [0, 0, 0])
  let degenerate = 0

  await mapWithConcurrency(rows, CONCURRENCY, async ({ table, row }) => {
    const { data: blob, error } = await supabase.storage.from('brand-images').download(row.storage_path)
    if (error) throw error
    if (!blob) throw new Error(`Storage download returned no data for ${table}/${row.id}`)
    const focal = await computeFocalPoint(Buffer.from(await blob.arrayBuffer()))
    const focalX = focal?.x ?? 0.5
    const focalY = focal?.y ?? 0.5
    if (!focal) degenerate += 1
    incrementHistogram(histogram, focalX, focalY)

    if (options.live) {
      // `as never` because the generated database types predate the focal
      // migration, so the typed `update` payload rejects columns the remote
      // schema will have. Drop the cast once `pnpm db:types` is regenerated.
      const { error: updateError } = await supabase
        .from(table)
        .update({ focal_x: focalX, focal_y: focalY } as never)
        .eq('id', row.id)
      if (updateError) throw updateError
    }
  })

  console.log(`${options.live ? 'Live' : 'Dry run'}: measured ${rows.length} row(s)`)
  console.log('Focal-point histogram (rows: Y thirds, columns: X thirds):')
  for (const row of histogram) console.log(row.join('  '))
  console.log(`Degenerate images (measured, centred): ${degenerate}`)
  if (!options.live) console.log('No changes made. Re-run with --live to apply.')
}

const scriptPath = process.argv.at(1)
if (scriptPath && import.meta.url === `file://${scriptPath}`) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
