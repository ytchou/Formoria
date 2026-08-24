/**
 * DEV-1551 (task 5) — backfill bucket-relative `storage_path` companions.
 *
 * Every image read is moving behind a same-origin `/i/<bucket-relative-path>`
 * route so the `brand-images` bucket can be flipped private. That only works if
 * every image row carries a KEY, not just a public url. Three tables already
 * had a path column and needed filling where null; three hero columns were
 * added by `20260822100000_add_hero_image_storage_path.sql` and start empty.
 *
 * Audit-by-default, like `scripts/brand-storage-maintenance.ts`:
 *
 *   pnpm tsx scripts/backfill-storage-paths.ts            # audit, no writes
 *   pnpm tsx scripts/backfill-storage-paths.ts audit
 *   pnpm tsx scripts/backfill-storage-paths.ts backfill --live
 *
 * `backfill` without `--live` is still a dry run.
 *
 * Structure note: all derivation and decision logic lives in the exported pure
 * seam (`resolveStoragePath`, `planBackfill`, `summarize`, `formatSummary`) and
 * is unit-tested with plain row objects. The Supabase client is confined to the
 * thin IO layer below it — this repo forbids mocking Supabase, so the seam must
 * be drivable without a client.
 */
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// The READ-path twin, deliberately not the delete-path `storageKeyFromPublicUrl`:
// this backfill covers `submissions/` and `event-exhibitors/` keys too, and the
// delete-path helper is scoped to `brands/` alone on purpose. Nothing here
// deletes, so resolving the wider prefix set is the safe direction.
import { storageKeyFromPublicUrlForRead } from '@/lib/services/image-upload'

const PAGE_SIZE = 1_000

export type BackfillTarget = {
  /** Postgres table name. */
  table: string
  /** Column holding the public Supabase url. */
  urlColumn: string
  /** Column that must end up holding the bucket-relative key. */
  pathColumn: string
  /**
   * Column that, when NOT null, means this row borrows another row's storage
   * object and must therefore keep a NULL path of its own.
   *
   * `submission_images` carries the check constraint
   * `origin_brand_image_id IS NULL OR storage_path IS NULL`: a row cloned from
   * an existing brand image points at that image rather than owning bytes.
   * Filling its path is not merely rejected by Postgres, it is wrong -- it
   * would give two rows ownership of one object, and the storage sweep decides
   * what to delete by counting owners.
   */
  skipWhenSet?: string
}

export const BACKFILL_TARGETS: readonly BackfillTarget[] = [
  { table: 'brand_images', urlColumn: 'url', pathColumn: 'storage_path' },
  {
    table: 'submission_images',
    urlColumn: 'url',
    pathColumn: 'storage_path',
    skipWhenSet: 'origin_brand_image_id',
  },
  {
    table: 'event_exhibitors',
    urlColumn: 'image_url',
    pathColumn: 'image_storage_path',
  },
  {
    table: 'brands',
    urlColumn: 'hero_image_url',
    pathColumn: 'hero_image_storage_path',
  },
  {
    table: 'brand_submissions',
    urlColumn: 'hero_image_url',
    pathColumn: 'hero_image_storage_path',
  },
  {
    table: 'events',
    urlColumn: 'hero_image_url',
    pathColumn: 'hero_image_storage_path',
  },
] as const

/** A row reduced to the three fields the decision depends on. */
export type BackfillRow = {
  id: string
  url: string | null | undefined
  storagePath: string | null | undefined
}

export type PlannedUpdate = { id: string; storagePath: string }
export type UnresolvableRow = { id: string; url: string }

export type TablePlan = {
  target: BackfillTarget
  /** Rows examined. */
  scanned: number
  /** Rows left alone because `pathColumn` was already set. */
  alreadySet: number
  /** Rows with no url to derive from. */
  noUrl: number
  updates: PlannedUpdate[]
  /** Rows whose url does not carry the bucket prefix — reported, never guessed. */
  unresolvable: UnresolvableRow[]
}

/**
 * Bucket-relative key for a public url, or null when the url is not a
 * `brand-images` public url we recognise. Null is a REPORT, never a guess: the
 * caller counts the row unresolvable and writes nothing.
 */
export function resolveStoragePath(url: string | null | undefined): string | null {
  if (typeof url !== 'string') {
    return null
  }
  const trimmed = url.trim()
  if (!trimmed) {
    return null
  }
  return storageKeyFromPublicUrlForRead(trimmed)
}

function hasValue(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Decide, for one table, what would be written. Pure: no client, no IO.
 * Idempotent by construction — a row whose path is already set is counted in
 * `alreadySet` and never appears in `updates`.
 */
export function planBackfill(
  target: BackfillTarget,
  rows: readonly BackfillRow[]
): TablePlan {
  const plan: TablePlan = {
    target,
    scanned: rows.length,
    alreadySet: 0,
    noUrl: 0,
    updates: [],
    unresolvable: [],
  }

  for (const row of rows) {
    if (hasValue(row.storagePath)) {
      plan.alreadySet += 1
      continue
    }
    if (!hasValue(row.url)) {
      plan.noUrl += 1
      continue
    }
    const storagePath = resolveStoragePath(row.url)
    if (storagePath === null) {
      plan.unresolvable.push({ id: row.id, url: row.url.trim() })
      continue
    }
    plan.updates.push({ id: row.id, storagePath })
  }

  return plan
}

export type BackfillSummary = {
  perTable: {
    table: string
    pathColumn: string
    scanned: number
    alreadySet: number
    noUrl: number
    fill: number
    unresolvable: number
  }[]
  totalScanned: number
  totalFill: number
  totalUnresolvable: number
}

export function summarize(plans: readonly TablePlan[]): BackfillSummary {
  const perTable = plans.map((plan) => ({
    table: plan.target.table,
    pathColumn: plan.target.pathColumn,
    scanned: plan.scanned,
    alreadySet: plan.alreadySet,
    noUrl: plan.noUrl,
    fill: plan.updates.length,
    unresolvable: plan.unresolvable.length,
  }))

  return {
    perTable,
    totalScanned: perTable.reduce((sum, row) => sum + row.scanned, 0),
    totalFill: perTable.reduce((sum, row) => sum + row.fill, 0),
    totalUnresolvable: perTable.reduce((sum, row) => sum + row.unresolvable, 0),
  }
}

const UNRESOLVABLE_SAMPLE_SIZE = 10

export function formatSummary(plans: readonly TablePlan[], live: boolean): string {
  const summary = summarize(plans)
  const lines: string[] = []

  lines.push(live ? 'Storage path backfill (LIVE)' : 'Storage path backfill (dry run)')
  lines.push('')
  for (const row of summary.perTable) {
    lines.push(
      `- ${row.table}.${row.pathColumn}: ${live ? 'filled' : 'would fill'} ${row.fill}` +
        ` (scanned ${row.scanned}, already set ${row.alreadySet},` +
        ` no url ${row.noUrl}, unresolvable ${row.unresolvable})`
    )
  }
  lines.push('')
  lines.push(
    `Total ${live ? 'filled' : 'fillable'}: ${summary.totalFill} of ${summary.totalScanned} scanned`
  )
  lines.push(`Unresolvable (reported, not written): ${summary.totalUnresolvable}`)

  const unresolvable = plans.flatMap((plan) =>
    plan.unresolvable.map((row) => `${plan.target.table}:${row.id} ${row.url}`)
  )
  if (unresolvable.length > 0) {
    lines.push('')
    lines.push('Unresolvable rows (url does not carry the bucket prefix):')
    for (const entry of unresolvable.slice(0, UNRESOLVABLE_SAMPLE_SIZE)) {
      lines.push(`  ${entry}`)
    }
    if (unresolvable.length > UNRESOLVABLE_SAMPLE_SIZE) {
      lines.push(`  ... and ${unresolvable.length - UNRESOLVABLE_SAMPLE_SIZE} more`)
    }
  }

  if (!live) {
    lines.push('')
    lines.push('Dry run complete. Re-run with `backfill --live` to write these paths.')
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// IO layer. Everything below needs a real database and is not unit-tested.
// ---------------------------------------------------------------------------

type ServiceClient = ReturnType<typeof createSupabaseClient>

function createServiceClient(): ServiceClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
  }
  if (!serviceRoleKey) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY; this maintenance script requires a service role key'
    )
  }

  return createSupabaseClient(url, serviceRoleKey)
}

async function fetchRows(
  supabase: ServiceClient,
  target: BackfillTarget
): Promise<BackfillRow[]> {
  const rows: BackfillRow[] = []
  let from = 0

  for (;;) {
    let query = supabase
      .from(target.table)
      .select(`id, ${target.urlColumn}, ${target.pathColumn}`)
      .not(target.urlColumn, 'is', null)
      .is(target.pathColumn, null)

    // Excluded at the query, not filtered after: a borrowed-object row is not
    // an unresolvable row, and counting it as one would make every run report
    // failures that are actually correct state.
    if (target.skipWhenSet) {
      query = query.is(target.skipWhenSet, null)
    }

    const { data, error } = await query
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      throw new Error(`Failed to read ${target.table}: ${error.message}`)
    }

    const page = (data ?? []) as unknown as Record<string, unknown>[]
    for (const record of page) {
      rows.push({
        id: String(record.id),
        url: (record[target.urlColumn] as string | null) ?? null,
        storagePath: (record[target.pathColumn] as string | null) ?? null,
      })
    }

    if (page.length < PAGE_SIZE) {
      break
    }
    from += PAGE_SIZE
  }

  return rows
}

async function applyPlan(supabase: ServiceClient, plan: TablePlan): Promise<void> {
  for (const update of plan.updates) {
    // Guarded write: the `is null` predicate makes a concurrent writer win
    // rather than being clobbered, and keeps a re-run a no-op.
    const { error } = await supabase
      .from(plan.target.table)
      // `table` and `pathColumn` are union-typed across six targets, so the
      // generated row type collapses to `never`. Cast is safe because
      // BACKFILL_TARGETS pairs each table with its own text column; drop it
      // once the client is instantiated per-table with a concrete generic.
      .update({ [plan.target.pathColumn]: update.storagePath } as never)
      .eq('id', update.id)
      .is(plan.target.pathColumn, null)

    if (error) {
      throw new Error(
        `Failed to update ${plan.target.table}:${update.id}: ${error.message}`
      )
    }
  }
}

async function run(live: boolean): Promise<void> {
  const supabase = createServiceClient()
  const plans: TablePlan[] = []

  for (const target of BACKFILL_TARGETS) {
    const rows = await fetchRows(supabase, target)
    const plan = planBackfill(target, rows)
    if (live) {
      await applyPlan(supabase, plan)
    }
    plans.push(plan)
  }

  console.log(formatSummary(plans, live))
}

const USAGE =
  'Usage: backfill-storage-paths.ts [audit | backfill [--live]] (audit is the default and writes nothing)'

async function main(): Promise<void> {
  const subcommand = process.argv[2] ?? 'audit'
  const args = process.argv.slice(3)

  if (subcommand === 'audit' && args.length === 0) {
    await run(false)
    return
  }

  if (
    subcommand === 'backfill' &&
    args.every((argument) => argument === '--live') &&
    args.length <= 1
  ) {
    await run(args.includes('--live'))
    return
  }

  if (subcommand !== 'audit' && subcommand !== 'backfill') {
    throw new Error(`Unknown subcommand "${subcommand}". ${USAGE}`)
  }

  throw new Error(`Invalid arguments for ${subcommand}. ${USAGE}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
