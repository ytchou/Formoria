import { createServiceClient } from '@/lib/supabase/service'
import { mapWithConcurrency } from '@/lib/services/_shared/concurrency'
import { computeFocalPoint } from '@/lib/services/image-download'

/**
 * Backfill focal measurements from the stored object, never source_url: the
 * stored bytes are what render and have already passed the live path's rotate
 * and resize processing.
 *
 * Three outcomes, deliberately written differently:
 *   1. measured, off-centre  -> the measured point is written.
 *   2. measured, centred     -> 0.5/0.5 is written. `computeFocalPoint` read the
 *      image fine and its flip-check either found the subject at the centre or
 *      fell back to the centre because the image is degenerate. Writing the
 *      value is what stops the resume cursor from re-downloading it forever.
 *   3. unreadable (null)     -> NOTHING is written; the row stays null. It was
 *      never measured, and recording it as a measured centre would burn the
 *      resume cursor (`focal_x is null`) on a row only a full `--force` pass
 *      over every row could ever revisit. Such rows are counted as skipped and
 *      re-attempted by the next run.
 * The live write path also leaves a failed measurement null, so (3) matches it;
 * (2) is the deliberate asymmetry that keeps focal_x null a reliable cursor.
 *
 * A row whose storage object is missing or whose update fails is counted and
 * skipped, never fatal: image retention and brand-storage-maintenance delete
 * objects while rows survive, and without a per-row catch one such row made the
 * whole backfill permanently uncompletable — every re-run re-selected it and
 * died on it again.
 *
 * Dry-run is the default. Review its 3x3 histogram and the centred/unreadable
 * counts before using --live. This script only updates focal columns and never
 * mutates storage objects. A run that skipped any row exits non-zero.
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
  let measured = 0
  let centredBoth = 0
  let centredOneAxis = 0
  let unreadable = 0
  const failures: string[] = []

  await mapWithConcurrency(rows, CONCURRENCY, async ({ table, row }) => {
    // One bad row must never end the run: mapWithConcurrency awaits Promise.all,
    // so a single rejection aborts every remaining row after an arbitrary prefix
    // has already been written under --live.
    try {
      const { data: blob, error } = await supabase.storage.from('brand-images').download(row.storage_path)
      if (error) throw error
      if (!blob) throw new Error(`Storage download returned no data for ${table}/${row.id}`)
      const focal = await computeFocalPoint(Buffer.from(await blob.arrayBuffer()))
      if (!focal) {
        // Unreadable: bad bytes, unsupported format, or sharp threw. Leave the
        // row null so the next run retries it instead of recording a centre
        // that was never measured.
        unreadable += 1
        failures.push(`${table}/${row.id}: unreadable image (${row.storage_path})`)
        return
      }

      measured += 1
      // `computeFocalPoint` returns a bare point, so a genuinely centred subject
      // and `resolveAxis`'s degenerate fallback are indistinguishable from the
      // returned value alone — both are exactly 0.5 on that axis. The counter is
      // therefore labelled for what it can honestly measure ("centred") rather
      // than claiming to count degeneracy. Upgrade path: have computeFocalPoint
      // report per-axis degeneracy (src/lib/services/image-download.ts) and
      // split this counter.
      const axesAtCentre = (focal.x === 0.5 ? 1 : 0) + (focal.y === 0.5 ? 1 : 0)
      if (axesAtCentre === 2) centredBoth += 1
      else if (axesAtCentre === 1) centredOneAxis += 1
      incrementHistogram(histogram, focal.x, focal.y)

      if (options.live) {
        // `as never` because the generated database types predate the focal
        // migration, so the typed `update` payload rejects columns the remote
        // schema will have. Drop the cast once `pnpm db:types` is regenerated.
        const { error: updateError } = await supabase
          .from(table)
          .update({ focal_x: focal.x, focal_y: focal.y } as never)
          .eq('id', row.id)
        if (updateError) throw updateError
      }
    } catch (error: unknown) {
      failures.push(
        `${table}/${row.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })

  const failed = failures.length - unreadable
  console.log(`${options.live ? 'Live' : 'Dry run'}: ${rows.length} row(s) selected, ${measured} measured`)
  console.log('Focal-point histogram over measured rows (rows: Y thirds, columns: X thirds):')
  for (const row of histogram) console.log(row.join('  '))
  console.log(
    `Centred on both axes (degenerate fallback or a truly centred subject — not separable): ${centredBoth}` +
      ` (${measured === 0 ? '0.0' : ((centredBoth / measured) * 100).toFixed(1)}% of measured)`,
  )
  console.log(`Centred on exactly one axis: ${centredOneAxis}`)
  console.log(`Unreadable (left null, retried next run): ${unreadable}`)
  console.log(`Errored (download or update failed, left null): ${failed}`)
  if (failures.length > 0) {
    // Bounded sample: a full list of thousands of ids would bury the summary the
    // operator gate actually reads.
    for (const line of failures.slice(0, 20)) console.log(`  skipped ${line}`)
    if (failures.length > 20) console.log(`  ... and ${failures.length - 20} more`)
    console.log(
      `${failures.length} row(s) skipped and left null. Repair them (or accept the loss) and re-run; the run is NOT complete.`,
    )
    process.exitCode = 1
  }
  if (!options.live) console.log('No changes made. Re-run with --live to apply.')
}

const scriptPath = process.argv.at(1)
if (scriptPath && import.meta.url === `file://${scriptPath}`) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
