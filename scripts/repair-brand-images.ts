import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServiceClient } from '@/lib/supabase/server'
import { syncHeroDenormalized } from '@/lib/services/brand-images'
import { storageKeyFromPublicUrl } from '@/lib/services/image-upload'
import { JUNK_TAGS } from '@/lib/services/enrich-phases/classify-images'
import { listAllObjects } from './brand-storage-maintenance'

// ---------------------------------------------------------------------------
// One-off repair for the three known brand_images data defects:
//   (a) active rows whose storage_path points at an object that no longer
//       exists in the bucket (owner edits used to delete storage out from under
//       a live row) — these render as the letter-tile fallback forever.
//   (b) legacy rows that hotlink a third-party host and were never mirrored
//       into our bucket — nothing to repair, they should simply go away.
//   (c) active rows carrying a junk classification tag. insertBrandImage used
//       to resurrect a rejected row on re-download (the upsert merged only the
//       payload's columns, so status flipped back to active while the junk tags
//       stayed), and `.is('tags', null)` kept the classifier from ever looking
//       at it again. The insert path is fixed; this pass cleans up the rows the
//       loop already produced.
//   (d) rows the image classifier rejected WITHOUT ever getting a verdict.
//       classifyImages used to turn a failed OpenAI call (`content: null`) into
//       null verdicts, which read as junk: status -> 'rejected', storage_path ->
//       null, and the storage object deleted. Two HTTP 400 `invalid_image_url`
//       responses destroyed 18 live images that way. Those rows are exactly
//       `status = 'rejected' AND tags IS NULL AND rejection_reasons IS NULL AND
//       rejected_at IS NULL` — new explicit rejects also have a null tag, so
//       the lifecycle fields distinguish them from a missing verdict. This
//       pass reactivates legacy rows, but ONLY the ones whose bytes are still there: the
//       url is HTTP-probed first, because storage_path is null on every
//       affected row so the bucket listing cannot decide it. Fail closed —
//       any non-2xx, network error or timeout leaves the row rejected. A false
//       positive would recreate the dangling row of pass (a), which is strictly
//       worse than leaving a recoverable image rejected. `tags` is left NULL so
//       the (now fixed) classifier reclassifies the row on the next run; this
//       pass invents no tag and no score, and deletes nothing from storage.
//       It spans BOTH `brand_images` and `submission_images`.
//
// ORDERING — pass (d) must be run only AFTER the classify-images fix is
// DEPLOYED. If the old classifier is still live, the next curation run will
// re-destroy exactly the rows this pass restores.
//
// Pass (d) cannot collide with (a)/(b)/(c): (a) and (c) only look at ACTIVE
// rows, and (d) only reactivates rows whose url sits on our brand-images public
// prefix — which makes them supabase-hosted, so they can never be in (b)'s
// hotlink set either.
//
// Afterwards each affected brand's denormalized `brands.hero_image_url` is
// reconciled. That step is NOT a blanket syncHeroDenormalized() call, because
// syncHeroDenormalized nulls the column when a brand has no active rows left —
// which is precisely the state pass (a) creates. Nulling a hero url that still
// points at a live bucket object would break the brand detail page (with zero
// brand_images rows the page falls back to brands.hero_image_url), i.e. leave
// the brand strictly worse off than the bug we came to fix. So the rule is:
//   - >= 1 active row remaining  -> syncHeroDenormalized (picks a real row)
//   - 0 active rows + hero url resolves to a LIVE object -> leave untouched
//   - 0 active rows + hero url IS one of the objects behind a row this run
//     rejects as junk -> sync (nulls it). The object is live only because
//     pass (c) deliberately leaves storage_path and the bytes intact for
//     reversibility; treating that as "a good image whose row went dangling"
//     would re-display the exact junk we came to remove.
//   - 0 active rows + hero url missing from bucket / external -> sync (nulls
//     it, so the UI renders a clean fallback tile instead of a broken <img>)
//   - 0 active rows + no hero url -> nothing to do
// The dry run prints this decision per brand, so a preview predicts the live
// run exactly.
//
// A brand this run empties is also delisted, whichever pass emptied it —
// pass (a), (b) or (c) — with one exception: a brand whose hero decision was
// `keep` still renders a real image on its detail page, so it is not imageless
// in the user-visible sense and stays approved. A 404 is strictly worse than
// the bug. Same rule, one layer up — see planBrandHides. The junk-hero
// exception above is what makes that safe: a brand whose hero IS the junk gets
// `clear`, not `keep`, so it is hidden rather than left displaying junk.
//
// Safe by default: requires --live to mutate, and always writes a restore
// manifest before touching anything.
// ---------------------------------------------------------------------------

const BUCKET_TABLE = 'brand_images'
const PAGE_SIZE = 1_000
const CHUNK_SIZE = 100
const BACKUP_DIRECTORY = path.join('scripts', 'backup')
/**
 * Circuit-breaker threshold for pass (a). A truncated or empty bucket listing
 * makes every active row look dangling, so the damage pattern of a listing
 * failure is "many brands lose ALL of their images at once". Organic rot is
 * scattered: a brand losing its entire active set is rare, more than two at
 * once is not plausible. Above this, refuse to mutate without --force.
 */
const MAX_BRANDS_FULLY_CLEARED = 2
/**
 * Circuit-breaker threshold for the delist step. Deliberately NOT re-sized when
 * the hide rule broadened from "junk-emptied brands" to "any brand this run
 * empties": 80 was calibrated against the junk-only population (72 junk rows
 * across ~66 brands), so leaving it in place forces the operator to look at the
 * new, larger number rather than rubber-stamping it. A hide set materially
 * above this means either the broadened rule is biting harder than expected or
 * a selector matched something it should not have, and hiding brands is
 * user-visible — a hidden brand 404s. Above this, refuse to mutate without
 * --force.
 */
const MAX_BRANDS_HIDDEN = 80
/**
 * Tags this sweep can purge on demand even though the classifier no longer
 * treats them as junk.
 *
 * `logo` used to live in JUNK_TAGS, so --include-logos derived its meaning from
 * that membership. The classifier now keeps logos (a clean brand mark reads far
 * better than a letter tile, and logo rows score p50 90), which left this flag
 * inert. Classifier policy and a manual operator sweep are separate decisions,
 * so the sweep carries its own set: purging logos stays available to an operator
 * who explicitly asks for it, and stays off by default.
 */
const OPT_IN_PURGE_TAGS = new Set(['logo'])

/**
 * Every tag the sweep considers. Opt-in tags are always *detected* so the report
 * can surface them; `includeLogos` only decides reject-vs-report.
 */
const SWEEP_CANDIDATE_TAGS = new Set([...JUNK_TAGS, ...OPT_IN_PURGE_TAGS])
/**
 * Circuit-breaker thresholds for pass (d).
 *
 * Measured 2026-07-29: the selector matches 1323 rows (1246 brand_images —
 * mostly a legacy batch created 2026-07-06 — plus 77 submission_images), but
 * only ~10 of those urls still resolve. The dead 99% are filtered out by the
 * fail-closed probe and never mutated.
 *
 * So the guard that matters is on rows we would actually WRITE, not on rows the
 * selector matched: capping candidates blocks a ~10-row repair because 1300
 * unrelated rows happen to share the predicate. MAX_REACTIVATIONS is the real
 * blast radius — "mass un-rejection" means mass *writes*, and this is the
 * number that bounds them.
 *
 * MAX_NULL_VERDICT_CANDIDATES stays as a much looser second line of defence: it
 * catches a selector that lost its `tags IS NULL` clause entirely (which would
 * match tens of thousands), without tripping on the known legacy population.
 */
const MAX_REACTIVATIONS = 60
const MAX_NULL_VERDICT_CANDIDATES = 5_000
/**
 * Reachability probe budget per row. Short on purpose: the probe answers "do
 * the bytes still exist", and a slow answer is indistinguishable from no answer
 * for that question. A timeout fails closed (row stays rejected).
 */
const REACHABILITY_TIMEOUT_MS = 8_000
/**
 * Parallel reachability probes. Bounded so a ~1300-row dry run finishes in
 * seconds without bursting our own storage endpoint.
 */
const REACHABILITY_CONCURRENCY = 20

/**
 * Only the columns this script reasons about are declared. Rows are fetched
 * with select('*'), so instances carry every `brand_images` column at runtime
 * and the manifest serializes all of them — see loadBrandImages().
 */
type BrandImageRow = {
  id: string
  brand_id: string
  url: string
  storage_path: string | null
  status: string
  source: string | null
  sort_order: number | null
  tags: string[] | null
  score: number | null
}

/**
 * The two tables pass (d) spans. Deliberately scoped to that pass — the rest of
 * the script stays `brand_images`-only (BUCKET_TABLE).
 */
export type RepairableImageTable = 'brand_images' | 'submission_images'

/**
 * The table-agnostic subset pass (d) reasons about. `brand_id` exists only on
 * `brand_images`; it is carried so the report can warn when a reactivated row
 * belongs to a brand this same run delists. Rows are fetched with select('*'),
 * so instances carry every column at runtime and the manifest serializes all of
 * them — the restore is "set these ids back to status 'rejected'".
 */
export type RejectedImageRow = {
  id: string
  url: string
  status: string
  storage_path: string | null
  source: string | null
  tags: string[] | null
  rejection_reasons?: string[] | null
  rejected_at?: string | null
  brand_id?: string | null
}

/**
 * One pass (d) decision. `reactivate` flips status to 'active' and leaves tags
 * NULL; `skip` leaves the row exactly as it is. Every non-2xx, network error,
 * timeout and non-bucket url lands on `skip` — see planReactivations.
 */
export type ReactivationDecision = {
  table: RepairableImageTable
  row: RejectedImageRow
  action: 'reactivate' | 'skip'
  reason: string
}

type BrandRow = {
  id: string
  slug: string
  hero_image_url: string | null
  status: string
}

type BrandHideEntry = {
  brandId: string
  slug: string
  priorStatus: string
}

type ServiceClient = ReturnType<typeof createServiceClient>
type StorageListClient = Parameters<typeof listAllObjects>[0]

type CliOptions = {
  live: boolean
  force: boolean
  includeLogos: boolean
}

type BrandCounts = {
  slug: string
  before: number
  after: number
}

/**
 * What the hero-resync step will do for one affected brand.
 *   sync  — call syncHeroDenormalized; it will pick a remaining active row.
 *   keep  — no active rows left, but hero_image_url still resolves to a live
 *           bucket object that this run is NOT rejecting as junk. Leave it
 *           alone; the detail page renders it.
 *   clear — no active rows left and the hero url is missing/external, or it
 *           resolves to an object this run rejects as junk, so
 *           syncHeroDenormalized is called to null the url.
 *   skip  — no active rows left and no hero url to reconcile.
 */
type HeroAction = 'sync' | 'keep' | 'clear' | 'skip'

type HeroPlanEntry = {
  brandId: string
  slug: string
  action: HeroAction
  reason: string
}

type RepairManifest = {
  generatedAt: string
  mode: 'dry-run' | 'live'
  danglingRows: BrandImageRow[]
  externalRows: BrandImageRow[]
  junkRows: BrandImageRow[]
  /**
   * Every pass (d) decision, not just the mutated ones: the skipped rows are the
   * record of WHY an image was left rejected (404 vs. network error vs. not a
   * bucket url), which is what a re-run is compared against. Restore = set the
   * `reactivate` ids back to status 'rejected'.
   */
  reactivationPlan: ReactivationDecision[]
  brandsToHide: BrandHideEntry[]
  brandsBefore: BrandRow[]
}

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.error(
    [
      'Usage:',
      '  Preview: [--dry-run]   (default — no mutations)',
      '  Apply:   --live',
      '  Override: --force      (bypass the inventory safety check and the pass',
      '                          (d) candidate-count breaker; only use after',
      '                          manually confirming the bucket listing is',
      '                          complete and the losses are expected)',
      '  --include-logos        (pass (c) also rejects logo-tagged rows; by',
      '                          default they are kept — a real brand mark beats',
      '                          a letter tile)',
    ].join('\n'),
  )
}

function parseArgs(argv: string[]): CliOptions {
  let live = false
  let dryRun = false
  let force = false
  let includeLogos = false

  for (const arg of argv) {
    if (arg === '--live') {
      live = true
    } else if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--force') {
      force = true
    } else if (arg === '--include-logos') {
      includeLogos = true
    } else {
      console.error(`Unknown argument: ${arg}`)
      printUsage()
      process.exit(1)
    }
  }

  if (live && dryRun) {
    console.error('--live is mutually exclusive with --dry-run')
    printUsage()
    process.exit(1)
  }

  return { live, force, includeLogos }
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function fetchAllRows<T>(
  table: string,
  fetchPage: (from: number, to: number) => PromiseLike<{
    data: unknown[] | null
    error: { message: string } | null
  }>,
): Promise<T[]> {
  const rows: T[] = []

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await fetchPage(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(`${table} query failed: ${error.message}`)

    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  return rows
}

async function loadBrandImages(
  supabase: ServiceClient,
): Promise<BrandImageRow[]> {
  // select('*') is deliberate: pass (b) DELETEs whole rows, so the restore
  // manifest must carry every column (alt_en/alt_zh, tags, score, source_url,
  // width/height, dominant_color, phash, created_at, ...). A narrow projection
  // would make the manifest un-restorable — it would silently drop curated alt
  // text, classification tags and dedup phashes.
  return fetchAllRows<BrandImageRow>(BUCKET_TABLE, (from, to) =>
    supabase
      .from(BUCKET_TABLE)
      .select('*')
      .order('id', { ascending: true })
      .range(from, to),
  )
}

/**
 * Pass (d) candidates from one table: legacy rows rejected without a verdict.
 * New classifier rejects also have `tags IS NULL`, so rejection_reasons and
 * rejected_at must both remain NULL or this recovery pass would resurrect
 * intentional junk.
 * The two branches are spelled out rather than passing `table` to `.from()`
 * because the generated Supabase types make `from(union)` uncallable.
 *
 * select('*') for the same reason loadBrandImages uses it: the manifest must
 * carry every column so the run stays reversible.
 */
async function loadNullVerdictRejections(
  supabase: ServiceClient,
  table: RepairableImageTable,
): Promise<RejectedImageRow[]> {
  return fetchAllRows<RejectedImageRow>(table, (from, to) =>
    table === 'brand_images'
      ? supabase
          .from('brand_images')
          .select('*')
          .eq('status', 'rejected')
          .is('tags', null)
          .is('rejection_reasons', null)
          .is('rejected_at', null)
          .order('id', { ascending: true })
          .range(from, to)
      : supabase
          .from('submission_images')
          .select('*')
          .eq('status', 'rejected')
          .is('tags', null)
          .is('rejection_reasons', null)
          .is('rejected_at', null)
          .order('id', { ascending: true })
          .range(from, to),
  )
}

async function loadBrands(supabase: ServiceClient): Promise<BrandRow[]> {
  return fetchAllRows<BrandRow>('brands', (from, to) =>
    supabase
      .from('brands')
      // status is carried so pass (c) can record the prior value in the restore
      // manifest before hiding a brand.
      .select('id, slug, hero_image_url, status')
      .order('id', { ascending: true })
      .range(from, to),
  )
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * A url is "ours" only when it parses AND its host is a supabase.co subdomain.
 * Anything unparseable is treated as external (and therefore purged) — an
 * unparseable url can never resolve to a bucket object.
 */
function isSupabaseHostedUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().endsWith('.supabase.co')
  } catch {
    return false
  }
}

function isUnparseableUrl(url: string): boolean {
  try {
    new URL(url)
    return false
  } catch {
    return true
  }
}

function countActiveByBrand(rows: BrandImageRow[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (row.status !== 'active') continue
    counts.set(row.brand_id, (counts.get(row.brand_id) ?? 0) + 1)
  }
  return counts
}

/**
 * Splits the active rows carrying a junk classification tag into the ones this
 * run rejects and the logo-tagged ones it deliberately keeps. Pure so the dry
 * run and the live run share one selection.
 */
export function selectJunkRows(input: {
  rows: BrandImageRow[]
  includeLogos: boolean
}): { junkRows: BrandImageRow[]; excludedLogoRows: BrandImageRow[] } {
  const { rows, includeLogos } = input
  const junkRows: BrandImageRow[] = []
  const excludedLogoRows: BrandImageRow[] = []

  for (const row of rows) {
    if (row.status !== 'active') continue
    const tags = row.tags ?? []
    if (!tags.some((tag) => SWEEP_CANDIDATE_TAGS.has(tag))) continue

    // Rows whose only purgeable tag is an opt-in one are reported, not rejected,
    // when the operator did not ask for them.
    const optInOnly = tags.every(
      (tag) => !SWEEP_CANDIDATE_TAGS.has(tag) || OPT_IN_PURGE_TAGS.has(tag),
    )
    if (!includeLogos && optInOnly) {
      excludedLogoRows.push(row)
      continue
    }
    junkRows.push(row)
  }

  return { junkRows, excludedLogoRows }
}

/**
 * Does the object behind this url still exist? A ranged GET rather than a HEAD:
 * some storage edges answer HEAD from a cache that outlives the object, and one
 * byte is cheap. Anything other than a 2xx — 400, 404, DNS failure, socket
 * reset, timeout — answers `false`, because this pass must fail closed.
 *
 * Only ever called with a url that storageKeyFromPublicUrl has already accepted,
 * so it never fetches a third-party host.
 */
export async function probeUrlReachable(url: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Pass (d): decides, per candidate, whether a never-verdicted rejection may be
 * reactivated. Async but pure apart from `probe`, so the dry run and the live
 * run share one decision — the preview IS the plan that gets executed.
 *
 * Three gates, all fail-closed:
 *   1. the row must still be `status = 'rejected'` with NULL tags and no
 *      lifecycle verdict fields. A non-null tag or rejection timestamp is a
 *      real classifier verdict and is out of scope entirely — reverting it
 *      would re-publish images a working classifier deliberately rejected.
 *   2. the url must resolve to a key under our brand-images public prefix
 *      (storageKeyFromPublicUrl returns null otherwise). A legacy hotlink to a
 *      third-party host is never probed and never reactivated.
 *   3. the probe must answer 2xx. Not-2xx / error / timeout ⇒ stays rejected;
 *      reactivating a row whose bytes are gone would recreate the dangling row
 *      of pass (a), i.e. a permanent broken letter-tile on the brand page.
 *
 * Probed through a bounded worker pool. The matched population is ~1300 rows
 * (mostly a long-dead legacy batch), so a serial walk takes many minutes and
 * makes the dry run unusable. Decisions are written back by index, so the report
 * stays deterministic regardless of completion order.
 */
export async function planReactivations(input: {
  candidates: Array<{ table: RepairableImageTable; row: RejectedImageRow }>
  probe: (url: string) => Promise<boolean>
  concurrency?: number
}): Promise<ReactivationDecision[]> {
  const { candidates, probe } = input
  const decisions: ReactivationDecision[] = new Array<ReactivationDecision>(
    candidates.length,
  )

  async function decide(index: number): Promise<void> {
    const { table, row } = candidates[index]

    if (
      row.status !== 'rejected' ||
      row.tags !== null ||
      row.rejection_reasons != null ||
      row.rejected_at != null
    ) {
      decisions[index] = {
        table,
        row,
        action: 'skip',
        reason: 'not a legacy null-verdict rejection (status/tags/lifecycle fields out of scope)',
      }
      return
    }

    if (storageKeyFromPublicUrl(row.url) === null) {
      decisions[index] = {
        table,
        row,
        action: 'skip',
        reason: 'url is not on our brand-images public prefix',
      }
      return
    }

    // The probe swallows its own errors, but a throwing probe must still fail
    // closed rather than abort the run: one unreachable host cannot be allowed
    // to leave the other candidates unprocessed.
    let reachable = false
    try {
      reachable = await probe(row.url)
    } catch {
      reachable = false
    }

    decisions[index] = reachable
      ? { table, row, action: 'reactivate', reason: 'url still resolves (2xx)' }
      : {
          table,
          row,
          action: 'skip',
          reason: 'url did not answer 2xx — bytes are gone or unverifiable',
        }
  }

  const workers = Math.max(
    1,
    Math.min(input.concurrency ?? REACHABILITY_CONCURRENCY, candidates.length),
  )
  let next = 0
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (next < candidates.length) await decide(next++)
    }),
  )

  return decisions
}

/**
 * Circuit breaker for pass (d). The primary guard is on rows we would actually
 * WRITE — that is the blast radius of "mass un-rejection". The candidate count
 * is a much looser secondary guard for a selector that lost its `tags IS NULL`
 * clause outright. Any reason returned here blocks mutation unless --force.
 */
export function detectReactivationAnomalies(
  candidateCount: number,
  reactivationCount: number,
): string[] {
  const reasons: string[] = []

  if (reactivationCount > MAX_REACTIVATIONS) {
    reasons.push(
      `Pass (d) would reactivate ${reactivationCount} row(s), above the ` +
        `threshold of ${MAX_REACTIVATIONS}. Only ~10 of the matched rows had ` +
        'surviving bytes when this was measured, so a number materially above ' +
        'that means the probe is accepting urls it should not, and un-rejecting ' +
        'those would re-publish images somebody deliberately removed.',
    )
  }

  if (candidateCount > MAX_NULL_VERDICT_CANDIDATES) {
    reasons.push(
      `Pass (d) matched ${candidateCount} row(s) with status='rejected' AND ` +
        `tags IS NULL, above the threshold of ${MAX_NULL_VERDICT_CANDIDATES}. ` +
        'That is far beyond the known population and suggests the selector lost ' +
        'its tags IS NULL clause.',
    )
  }

  return reasons
}

/**
 * Brands this run empties and must therefore be delisted. The rule: hide any
 * brand this run empties, except one whose hero still resolves to a live
 * non-junk object.
 *
 * Every brand touched by this run is considered — the same affected set the
 * hero plan uses — not just the ones carrying a junk row. Pass (b) now deletes
 * the hotlink rows outright, including the currently-active ones, so a brand
 * can be emptied by pass (a) or (b) with no junk row anywhere; that fallout is
 * as user-visible as pass (c)'s and gets the same treatment.
 *
 * Three guards, all deliberate:
 *   - `before > 0` — a brand that already had zero active images was not
 *     emptied by this run, so this pass must not touch its status.
 *   - `status === 'approved'` — never un-hide, and never overwrite a status we
 *     did not set.
 *   - hero action !== 'keep' — see below.
 *
 * The hero plan is threaded in because the two decisions can contradict each
 * other. A brand emptied by this run has `after` 0, so this planner wants to
 * delist it, while planHeroResync may have decided `keep` — its hero_image_url
 * still resolves to a live bucket object, so the detail page renders a real
 * image. Hiding it would 404 a brand that the repair otherwise leaves intact,
 * which is exactly the "strictly worse off than the bug" outcome the `keep`
 * branch exists to prevent. `keep` therefore wins. A brand whose hero IS junk
 * this run rejects gets `clear`, not `keep`, so junk brands are unaffected by
 * this veto.
 */
export function planBrandHides(input: {
  affectedBrandIds: string[]
  activeCountsBefore: Map<string, number>
  activeCountsAfter: Map<string, number>
  brandById: Map<string, BrandRow>
  heroPlan: HeroPlanEntry[]
}): BrandHideEntry[] {
  const {
    affectedBrandIds,
    activeCountsBefore,
    activeCountsAfter,
    brandById,
    heroPlan,
  } = input

  const heroKeptBrandIds = new Set(
    heroPlan
      .filter((entry) => entry.action === 'keep')
      .map((entry) => entry.brandId),
  )
  const brandIds = [...new Set(affectedBrandIds)]

  return brandIds.flatMap((brandId) => {
    const before = activeCountsBefore.get(brandId) ?? 0
    const after = activeCountsAfter.get(brandId) ?? 0
    if (before === 0 || after > 0) return []
    if (heroKeptBrandIds.has(brandId)) return []

    const brand = brandById.get(brandId)
    if (brand?.status !== 'approved') return []

    return [{ brandId, slug: brand.slug, priorStatus: brand.status }]
  })
}

/**
 * Safety check for the inventory-driven pass (a). Returns human-readable
 * reasons why the computed damage set looks like a bad bucket listing rather
 * than genuine data rot. Any reason blocks mutation unless --force is passed.
 */
function detectInventoryAnomalies(
  objectCount: number,
  rows: BrandImageRow[],
  danglingRows: BrandImageRow[],
  slugById: Map<string, string>,
): string[] {
  const anomalies: string[] = []

  // Only an empty inventory that would actually cause damage is an anomaly —
  // an empty bucket with nothing to reject is a legitimate no-op.
  if (objectCount === 0 && danglingRows.length > 0) {
    anomalies.push(
      'Bucket inventory came back EMPTY. Every active row with a storage_path ' +
        'would be rejected — that is a storage listing failure, not data rot.',
    )
  }

  const danglingIds = new Set(danglingRows.map((row) => row.id))
  const before = countActiveByBrand(rows)
  const after = countActiveByBrand(
    rows.filter((row) => !danglingIds.has(row.id)),
  )
  const cleared = [...before.entries()]
    .filter(
      ([brandId, count]) => count > 0 && (after.get(brandId) ?? 0) === 0,
    )
    .map(([brandId]) => slugById.get(brandId) ?? brandId)
    .sort()

  if (cleared.length > MAX_BRANDS_FULLY_CLEARED) {
    anomalies.push(
      `Pass (a) would clear the ENTIRE active image set of ${cleared.length} ` +
        `brand(s), above the threshold of ${MAX_BRANDS_FULLY_CLEARED}: ` +
        `${cleared.join(', ')}.`,
    )
  }

  return anomalies
}

/**
 * Safety check for the delist step. Same spirit as detectInventoryAnomalies:
 * the damage pattern of a bad selector is "far more brands get delisted than
 * the known defect population", so cap the hide set.
 */
export function detectJunkAnomalies(brandsToHide: BrandHideEntry[]): string[] {
  if (brandsToHide.length <= MAX_BRANDS_HIDDEN) return []
  return [
    `This run would HIDE ${brandsToHide.length} brand(s), above the threshold ` +
      `of ${MAX_BRANDS_HIDDEN}. The rule is now "hide ANY brand this run ` +
      'empties (pass (a) dangling, (b) hotlink deletion, or (c) junk), except ' +
      'one whose hero still resolves to a live non-junk object" — broader than ' +
      'the junk-only population the threshold was sized against, so expect a ' +
      'higher count and confirm it before overriding. A hidden brand 404s, so ' +
      'this is user-visible.',
  ]
}

function reportAnomalies(anomalies: string[]): void {
  if (anomalies.length === 0) return
  console.log('\n!!! INVENTORY SAFETY CHECK FAILED !!!')
  for (const anomaly of anomalies) {
    console.log(`  - ${anomaly}`)
  }
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/**
 * One file per run, never a shared one. The filename used to be date-only and
 * mode-blind, and the dry run writes a manifest too — so a preview run executed
 * after a live run on the same date silently overwrote the live run's manifest
 * with POST-mutation state, destroying the only record of how to undo the live
 * run. Mode plus an HHMMSS stamp makes a collision impossible (two runs cannot
 * start in the same second), which is what the reversibility design assumes.
 */
function manifestPath(mode: RepairManifest['mode']): string {
  const now = new Date().toISOString()
  const date = now.slice(0, 10)
  const time = now.slice(11, 19).replace(/:/g, '')
  const label = mode === 'live' ? 'live' : 'dry'
  return path.join(
    BACKUP_DIRECTORY,
    `repair-brand-images-${date}-${label}-${time}.json`,
  )
}

async function writeManifest(manifest: RepairManifest): Promise<string> {
  const outputPath = manifestPath(manifest.mode)
  await mkdir(BACKUP_DIRECTORY, { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return outputPath
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

async function rejectDanglingRows(
  supabase: ServiceClient,
  rows: BrandImageRow[],
): Promise<void> {
  const ids = rows.map((row) => row.id)

  for (let index = 0; index < ids.length; index += CHUNK_SIZE) {
    const chunk = ids.slice(index, index + CHUNK_SIZE)
    const { error } = await supabase
      .from(BUCKET_TABLE)
      .update({ status: 'rejected', storage_path: null })
      .in('id', chunk)
    if (error) {
      throw new Error(`Failed to reject dangling rows: ${error.message}`)
    }
  }
}

async function deleteRows(
  supabase: ServiceClient,
  rows: BrandImageRow[],
): Promise<void> {
  const ids = rows.map((row) => row.id)

  for (let index = 0; index < ids.length; index += CHUNK_SIZE) {
    const chunk = ids.slice(index, index + CHUNK_SIZE)
    const { error } = await supabase
      .from(BUCKET_TABLE)
      .delete()
      .in('id', chunk)
    if (error) {
      throw new Error(`Failed to delete hotlink rows: ${error.message}`)
    }
  }
}

async function rejectJunkRows(
  supabase: ServiceClient,
  rows: BrandImageRow[],
): Promise<void> {
  const ids = rows.map((row) => row.id)

  for (let index = 0; index < ids.length; index += CHUNK_SIZE) {
    const chunk = ids.slice(index, index + CHUNK_SIZE)
    // Deliberately NOT nulling storage_path (applyClassifications does, pass (a)
    // does). These objects are intact and this pass is a bulk retro-fix, so the
    // manifest plus a live object makes it fully reversible; the storage bytes
    // are reclaimed later by `brand-storage-maintenance.ts purge`.
    const { error } = await supabase
      .from(BUCKET_TABLE)
      .update({ status: 'rejected' })
      .in('id', chunk)
    if (error) {
      throw new Error(`Failed to reject junk-tagged rows: ${error.message}`)
    }
  }
}

/**
 * Pass (d)'s only mutation: status back to 'active'. `tags` is deliberately NOT
 * written — leaving it NULL is what makes the fixed classifier pick the row up
 * and give it a real verdict on the next run. Nothing is removed from storage.
 *
 * The eq/is pair re-checks the selector at write time (same belt-and-braces as
 * hideBrands): if anything classified the row between the read and this update,
 * the update matches nothing rather than un-rejecting a real verdict.
 */
async function reactivateRows(
  supabase: ServiceClient,
  table: RepairableImageTable,
  rows: RejectedImageRow[],
): Promise<void> {
  const ids = rows.map((row) => row.id)

  for (let index = 0; index < ids.length; index += CHUNK_SIZE) {
    const chunk = ids.slice(index, index + CHUNK_SIZE)
    const { error } =
      table === 'brand_images'
        ? await supabase
            .from('brand_images')
            .update({ status: 'active' })
            .eq('status', 'rejected')
            .is('tags', null)
            .is('rejection_reasons', null)
            .is('rejected_at', null)
            .in('id', chunk)
        : await supabase
            .from('submission_images')
            .update({ status: 'active' })
            .eq('status', 'rejected')
            .is('tags', null)
            .is('rejection_reasons', null)
            .is('rejected_at', null)
            .in('id', chunk)
    if (error) {
      throw new Error(
        `Failed to reactivate null-verdict rows in ${table}: ${error.message}`,
      )
    }
  }
}

/**
 * Applies pass (d), with the dry-run gate INSIDE rather than at the call site:
 * `live === false` returns before touching the client, so the safe default
 * cannot be lost to a future refactor of repair()'s control flow. Returns the
 * number of rows actually mutated (0 in a dry run).
 */
export async function applyReactivations(
  supabase: ServiceClient,
  decisions: ReactivationDecision[],
  live: boolean,
): Promise<number> {
  const approved = decisions.filter((entry) => entry.action === 'reactivate')
  if (!live || approved.length === 0) return 0

  let mutated = 0
  for (const table of ['brand_images', 'submission_images'] as const) {
    const tableRows = approved
      .filter((entry) => entry.table === table)
      .map((entry) => entry.row)
    if (tableRows.length === 0) continue
    await reactivateRows(supabase, table, tableRows)
    mutated += tableRows.length
    console.log(
      `[OK] Reactivated ${tableRows.length} null-verdict rejection(s) in ${table}.`,
    )
  }
  return mutated
}

async function hideBrands(
  supabase: ServiceClient,
  entries: BrandHideEntry[],
): Promise<void> {
  const ids = entries.map((entry) => entry.brandId)

  for (let index = 0; index < ids.length; index += CHUNK_SIZE) {
    const chunk = ids.slice(index, index + CHUNK_SIZE)
    // The eq('status', 'approved') is a belt-and-braces re-check of the same
    // guard planBrandHides applies: never overwrite a status we did not set.
    const { error } = await supabase
      .from('brands')
      .update({ status: 'hidden' })
      .eq('status', 'approved')
      .in('id', chunk)
    if (error) {
      throw new Error(`Failed to hide emptied brands: ${error.message}`)
    }
  }
}

/**
 * Decides, per affected brand, whether the denormalized hero url may be
 * resynced. Pure so the dry run and the live run share one decision: the
 * preview is the plan that gets executed.
 *
 * `junkPaths` are the storage paths behind the rows pass (c) rejects in THIS
 * run. They are still present in `existingPaths` — rejectJunkRows deliberately
 * leaves storage_path and the bytes alone so the run stays reversible — so the
 * liveness check alone would answer `keep` for a brand whose hero IS the junk,
 * and the detail page (which falls back to brands.hero_image_url when a brand
 * has zero brand_images rows) would keep serving it. Rejecting the row would
 * then change nothing a visitor sees. A hero resolving to a junk path is
 * therefore treated as not-live and answered `clear`, with a reason that says
 * why — the dry-run report is the operator's only preview, and "the object is
 * gone" and "the object is live but is junk we just rejected" are different
 * facts to review.
 *
 * `junkPaths` must be derived from the same row set pass (c) actually rejects
 * (see selectJunkRows): with logos excluded, a logo-hero brand is not emptied
 * and correctly keeps its `keep`.
 *
 * Precedence rule, restated: keep wins over hide, EXCEPT when the hero is
 * itself junk rejected by this run.
 */
export function planHeroResync(input: {
  affectedBrandIds: string[]
  brandById: Map<string, BrandRow>
  activeCountsAfter: Map<string, number>
  existingPaths: Set<string>
  junkPaths: Set<string>
}): HeroPlanEntry[] {
  const { affectedBrandIds, brandById, activeCountsAfter, existingPaths, junkPaths } =
    input

  return affectedBrandIds.map((brandId) => {
    const brand = brandById.get(brandId)
    const slug = brand?.slug ?? brandId
    const activeAfter = activeCountsAfter.get(brandId) ?? 0

    if (activeAfter > 0) {
      return {
        brandId,
        slug,
        action: 'sync' as const,
        reason: `${activeAfter} active row(s) remain`,
      }
    }

    const heroUrl = brand?.hero_image_url?.trim() ?? ''
    if (heroUrl === '') {
      return {
        brandId,
        slug,
        action: 'skip' as const,
        reason: 'no active rows and no hero_image_url',
      }
    }

    // Only bucket-hosted urls can be checked against the inventory; an
    // external url is unverifiable here and is treated as not-live.
    const key = storageKeyFromPublicUrl(heroUrl)
    if (key !== null && existingPaths.has(key) && !junkPaths.has(key)) {
      return {
        brandId,
        slug,
        action: 'keep' as const,
        reason: `no active rows, but hero_image_url still resolves to a live object (${key})`,
      }
    }

    let reason: string
    if (key === null) {
      reason = `no active rows and hero_image_url is not a bucket url (${heroUrl})`
    } else if (junkPaths.has(key)) {
      // The object is live only because pass (c) leaves it in place; the row
      // behind it is being rejected as junk, so the hero must not survive it.
      reason = `no active rows and hero object is a junk row rejected by this run (${key})`
    } else {
      reason = `no active rows and hero object is missing from the bucket (${key})`
    }

    return { brandId, slug, action: 'clear' as const, reason }
  })
}

async function applyHeroPlan(
  supabase: ServiceClient,
  plan: HeroPlanEntry[],
): Promise<void> {
  for (const entry of plan) {
    if (entry.action === 'keep') {
      console.log(`[KEEP] ${entry.slug} — ${entry.reason}; left untouched`)
      continue
    }
    if (entry.action === 'skip') {
      console.log(`[SKIP] ${entry.slug} — ${entry.reason}`)
      continue
    }

    try {
      await syncHeroDenormalized(supabase, entry.brandId)
      const label = entry.action === 'clear' ? 'CLEAR' : 'SYNC'
      console.log(`[${label}] ${entry.slug} — ${entry.reason}`)
    } catch (err) {
      console.log(`[ERROR] hero resync failed for ${entry.slug} — ${String(err)}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function reportRows(label: string, rows: BrandImageRow[], slugById: Map<string, string>): void {
  console.log(`\n--- ${label} (${rows.length}) ---`)
  if (rows.length === 0) {
    console.log('  (none)')
    return
  }
  for (const row of rows) {
    const slug = slugById.get(row.brand_id) ?? row.brand_id
    const suffix = isUnparseableUrl(row.url) ? ' [unparseable url]' : ''
    console.log(
      `  ${slug} | ${row.id} | source:${row.source ?? 'null'} | ${row.url}${suffix}`,
    )
  }
}

// brandsToHide is threaded in because the hide set is no longer junk-only:
// reportJunkPlan lists hides for junk brands, but a brand emptied purely by
// pass (a)/(b) appears nowhere else, and a delist is the most user-visible
// thing this script does.
function reportCounts(
  counts: Map<string, BrandCounts>,
  brandsToHide: BrandHideEntry[],
): void {
  console.log('\n--- Per-brand active image counts ---')
  if (counts.size === 0) {
    console.log('  (no brands affected)')
    return
  }
  const hideSlugs = new Set(brandsToHide.map((entry) => entry.slug))
  const sorted = [...counts.values()].sort((left, right) =>
    left.slug.localeCompare(right.slug),
  )
  for (const { slug, before, after } of sorted) {
    let flag = ''
    if (after === 0) {
      flag = hideSlugs.has(slug)
        ? '  <-- DROPS TO ZERO, WOULD HIDE'
        : '  <-- DROPS TO ZERO (not hidden)'
    }
    console.log(`  ${slug.padEnd(40)} ${before} -> ${after}${flag}`)
  }
}

/**
 * Pass (c)'s per-brand preview: everything needed to predict the live run —
 * the junk tag and score that selected the row, the active-count delta, the
 * hero decision, and whether the brand gets delisted.
 */
function reportJunkPlan(
  junkRows: BrandImageRow[],
  excludedLogoRows: BrandImageRow[],
  counts: Map<string, BrandCounts>,
  heroPlan: HeroPlanEntry[],
  brandsToHide: BrandHideEntry[],
  slugById: Map<string, string>,
): void {
  console.log(`\n--- Junk-tagged active rows (${junkRows.length}) ---`)
  console.log(
    `  (${excludedLogoRows.length} logo-tagged row(s) excluded — pass ` +
      '--include-logos to reject them too)',
  )
  if (junkRows.length === 0) {
    console.log('  (none)')
    return
  }

  const heroByBrand = new Map(heroPlan.map((entry) => [entry.brandId, entry]))
  const hideIds = new Set(brandsToHide.map((entry) => entry.brandId))
  const sorted = [...junkRows].sort((left, right) =>
    (slugById.get(left.brand_id) ?? left.brand_id).localeCompare(
      slugById.get(right.brand_id) ?? right.brand_id,
    ),
  )

  for (const row of sorted) {
    const slug = slugById.get(row.brand_id) ?? row.brand_id
    const tags = (row.tags ?? []).filter((tag) => JUNK_TAGS.has(tag)).join(',')
    const count = counts.get(row.brand_id)
    const delta = count ? `${count.before} -> ${count.after}` : 'n/a'
    const hero = heroByBrand.get(row.brand_id)?.action ?? 'none'
    const hidden = hideIds.has(row.brand_id) ? 'WOULD HIDE' : 'stays visible'
    console.log(
      `  ${slug.padEnd(40)} tag:${tags.padEnd(12)} score:${String(row.score ?? 'null').padStart(4)} ` +
        `active:${delta.padEnd(10)} hero:${hero.padEnd(6)} ${hidden}`,
    )
  }
}

/**
 * Pass (d)'s preview: every candidate with its verdict and the reason, so a dry
 * run predicts the live run row for row.
 *
 * The trailing warning covers the one cross-pass interaction that exists: pass
 * (a)/(b)/(c) may delist a brand for having zero active images while pass (d)
 * hands one of its images back. Nothing is auto-corrected — the hide decision
 * belongs to those passes — but the operator is told to re-approve the brand.
 */
function reportReactivationPlan(
  decisions: ReactivationDecision[],
  candidateCount: number,
  brandsToHide: BrandHideEntry[],
  slugById: Map<string, string>,
): void {
  const reactivated = decisions.filter((entry) => entry.action === 'reactivate')
  console.log(
    `\n--- Null-verdict rejections (${candidateCount} candidate(s), ` +
      `${reactivated.length} reachable) ---`,
  )
  if (candidateCount === 0) {
    console.log('  (none)')
    return
  }
  if (decisions.length === 0) {
    console.log('  (not probed — the candidate-count breaker below tripped)')
    return
  }

  for (const entry of decisions) {
    const label = entry.action === 'reactivate' ? 'REACTIVATE' : 'LEAVE REJECTED'
    console.log(
      `  ${label.padEnd(15)} ${entry.table.padEnd(18)} ${entry.row.id} | ` +
        `source:${entry.row.source ?? 'null'} | ${entry.reason}`,
    )
  }

  const hiddenIds = new Set(brandsToHide.map((entry) => entry.brandId))
  const conflicts = [
    ...new Set(
      reactivated
        .map((entry) => entry.row.brand_id)
        .filter(
          (brandId): brandId is string =>
            typeof brandId === 'string' && hiddenIds.has(brandId),
        ),
    ),
  ].map((brandId) => slugById.get(brandId) ?? brandId)

  if (conflicts.length > 0) {
    console.log(
      `  !! ${conflicts.length} brand(s) would be delisted by pass (a)/(b)/(c) ` +
        'yet regain an image from pass (d): ' +
        `${conflicts.sort().join(', ')}. Re-approve them after this run.`,
    )
  }
}

const HERO_ACTION_LABEL: Record<HeroAction, string> = {
  sync: 'RESYNC (hero set from a remaining active row)',
  keep: 'KEEP   (hero url is live — left untouched)',
  clear: 'CLEAR  (hero url broken — will be nulled)',
  skip: 'SKIP   (nothing to reconcile)',
}

function reportHeroPlan(plan: HeroPlanEntry[]): void {
  console.log('\n--- hero_image_url plan (per affected brand) ---')
  if (plan.length === 0) {
    console.log('  (no brands affected)')
    return
  }
  const sorted = [...plan].sort((left, right) =>
    left.slug.localeCompare(right.slug),
  )
  for (const entry of sorted) {
    console.log(
      `  ${entry.slug.padEnd(40)} ${HERO_ACTION_LABEL[entry.action]} — ${entry.reason}`,
    )
  }
}

function countHeroActions(plan: HeroPlanEntry[]): Record<HeroAction, number> {
  const counts: Record<HeroAction, number> = {
    sync: 0,
    keep: 0,
    clear: 0,
    skip: 0,
  }
  for (const entry of plan) counts[entry.action] += 1
  return counts
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

async function repair({ live, force, includeLogos }: CliOptions): Promise<void> {
  const supabase = createServiceClient()

  const [rows, brands, objects, brandImageCandidates, submissionImageCandidates] =
    await Promise.all([
      loadBrandImages(supabase),
      loadBrands(supabase),
      listAllObjects(supabase as unknown as StorageListClient),
      loadNullVerdictRejections(supabase, 'brand_images'),
      loadNullVerdictRejections(supabase, 'submission_images'),
    ])

  const slugById = new Map(brands.map((brand) => [brand.id, brand.slug]))
  const brandById = new Map(brands.map((brand) => [brand.id, brand]))
  const existingPaths = new Set(objects.map((object) => object.path))

  // Pass (a): active rows whose storage object is gone.
  const danglingRows = rows.filter(
    (row) =>
      row.status === 'active' &&
      row.storage_path !== null &&
      !existingPaths.has(row.storage_path),
  )

  // Pass (b): rows hotlinking a non-supabase host (never mirrored into the
  // bucket). The `storage_path === null` clause makes the destructive pass
  // self-limiting: a row that IS mirrored into our bucket can never be deleted
  // here, whatever its url host says.
  const externalRows = rows.filter(
    (row) => !isSupabaseHostedUrl(row.url) && row.storage_path === null,
  )

  // Pass (c): active rows the classifier tagged as junk. They exist because
  // insertBrandImage used to resurrect rejected rows on re-download.
  const { junkRows, excludedLogoRows } = selectJunkRows({ rows, includeLogos })

  const removedIds = new Set([
    ...danglingRows.map((row) => row.id),
    ...externalRows.map((row) => row.id),
    ...junkRows.map((row) => row.id),
  ])
  const affectedBrandIds = [
    ...new Set(
      [...danglingRows, ...externalRows, ...junkRows].map((row) => row.brand_id),
    ),
  ]

  const beforeCounts = countActiveByBrand(rows)
  const afterCounts = countActiveByBrand(
    rows.filter((row) => !removedIds.has(row.id)),
  )
  const brandCounts = new Map<string, BrandCounts>(
    affectedBrandIds.map((brandId) => [
      brandId,
      {
        slug: slugById.get(brandId) ?? brandId,
        before: beforeCounts.get(brandId) ?? 0,
        after: afterCounts.get(brandId) ?? 0,
      },
    ]),
  )

  // Derived from junkRows, not from the whole junk-tagged population: with
  // logos excluded, an excluded logo row is not rejected and its object must
  // still count as a legitimate hero.
  const junkPaths = new Set(
    junkRows
      .map((row) => row.storage_path)
      .filter((storagePath): storagePath is string => storagePath !== null),
  )

  const heroPlan = planHeroResync({
    affectedBrandIds,
    brandById,
    activeCountsAfter: afterCounts,
    existingPaths,
    junkPaths,
  })

  // Pass (d): rejections the classifier never actually delivered a verdict for.
  // Probed in both modes — the dry run's whole job is to predict the live run,
  // and reachability is the only thing that decides it.
  const reactivationCandidates = [
    ...brandImageCandidates.map((row) => ({
      table: 'brand_images' as const,
      row,
    })),
    ...submissionImageCandidates.map((row) => ({
      table: 'submission_images' as const,
      row,
    })),
  ]
  // The candidate count is only the loose outer guard, so it is checked first:
  // if the selector matched an absurd population, skip probing entirely rather
  // than firing thousands of unexpected requests. With --force the operator has
  // accepted the count, so the plan is built normally.
  const candidateAnomalies = detectReactivationAnomalies(
    reactivationCandidates.length,
    0,
  )
  const reactivationPlan =
    candidateAnomalies.length > 0 && !force
      ? []
      : await planReactivations({
          candidates: reactivationCandidates,
          probe: probeUrlReachable,
        })
  // The real blast radius is rows we would WRITE, which is only knowable after
  // probing — the fail-closed probe discards the (large, already-dead) majority.
  const reactivationAnomalies = detectReactivationAnomalies(
    reactivationCandidates.length,
    reactivationPlan.filter((entry) => entry.action === 'reactivate').length,
  )
  const rowsToReactivate = reactivationPlan.filter(
    (entry) => entry.action === 'reactivate',
  )

  const brandsToHide = planBrandHides({
    affectedBrandIds,
    activeCountsBefore: beforeCounts,
    activeCountsAfter: afterCounts,
    brandById,
    heroPlan,
  })

  console.log(`Scanned ${rows.length} brand_images row(s) against ${objects.length} bucket object(s).`)
  reportRows('Dangling active rows (storage object missing)', danglingRows, slugById)
  reportRows('Legacy hotlink rows (non-supabase host)', externalRows, slugById)
  reportJunkPlan(junkRows, excludedLogoRows, brandCounts, heroPlan, brandsToHide, slugById)
  reportReactivationPlan(
    reactivationPlan,
    reactivationCandidates.length,
    brandsToHide,
    slugById,
  )
  reportCounts(brandCounts, brandsToHide)
  reportHeroPlan(heroPlan)

  const anomalies = [
    ...detectInventoryAnomalies(objects.length, rows, danglingRows, slugById),
    ...detectJunkAnomalies(brandsToHide),
    ...reactivationAnomalies,
  ]
  reportAnomalies(anomalies)

  // Manifest is written before any mutation: a crash between manifest and
  // mutation costs a stale file; the reverse order costs unrecoverable rows.
  const manifest: RepairManifest = {
    generatedAt: new Date().toISOString(),
    mode: live ? 'live' : 'dry-run',
    danglingRows,
    externalRows,
    junkRows,
    reactivationPlan,
    brandsToHide,
    brandsBefore: brands.filter((brand) =>
      brandCounts.has(brand.id),
    ),
  }
  const outputPath = await writeManifest(manifest)
  console.log(`\nRestore manifest: ${outputPath}`)

  if (!live) {
    const heroCounts = countHeroActions(heroPlan)
    console.log(
      `\nA --live run would: reject ${danglingRows.length} dangling row(s), ` +
        `delete ${externalRows.length} hotlink row(s), reject ${junkRows.length} junk-tagged row(s) ` +
        `(${excludedLogoRows.length} logo row(s) excluded), ` +
        `reactivate ${rowsToReactivate.length} of ${reactivationCandidates.length} null-verdict rejection(s), ` +
        `hide ${brandsToHide.length} emptied brand(s), ` +
        `resync ${heroCounts.sync} hero(es), ` +
        `keep ${heroCounts.keep} live hero url(s) untouched, ` +
        `clear ${heroCounts.clear} broken hero url(s), skip ${heroCounts.skip}.`,
    )
    console.log('\nDry run complete. No changes made. Re-run with --live to apply.')
    if (anomalies.length > 0 && !force) {
      console.log(
        'A --live run would ABORT on the safety check above unless --force is passed.',
      )
    }
    return
  }

  // Fail toward doing nothing: an anomalous inventory must never mass-mutate.
  if (anomalies.length > 0 && !force) {
    console.error(
      '\nRefusing to mutate: the damage set above is consistent with an ' +
        'incomplete bucket listing.\nRe-run the audit, confirm the listing is ' +
        'complete, then pass --force to override.',
    )
    process.exitCode = 1
    return
  }
  if (anomalies.length > 0) {
    console.log('\n--force supplied — proceeding despite the safety check above.')
  }

  if (danglingRows.length > 0) {
    await rejectDanglingRows(supabase, danglingRows)
    console.log(`[OK] Rejected ${danglingRows.length} dangling row(s).`)
  }
  if (externalRows.length > 0) {
    await deleteRows(supabase, externalRows)
    console.log(`[OK] Deleted ${externalRows.length} legacy hotlink row(s).`)
  }
  if (junkRows.length > 0) {
    await rejectJunkRows(supabase, junkRows)
    console.log(`[OK] Rejected ${junkRows.length} junk-tagged row(s).`)
  }

  await applyHeroPlan(supabase, heroPlan)
  const heroCounts = countHeroActions(heroPlan)

  // Hidden last: a brand is only delisted once its images are actually gone, so
  // a crash mid-run leaves brands visible with fewer images rather than
  // delisted for images they still have.
  if (brandsToHide.length > 0) {
    await hideBrands(supabase, brandsToHide)
    console.log(`[OK] Hid ${brandsToHide.length} brand(s) left with zero active images.`)
  }

  // Pass (d) runs LAST, deliberately: syncHeroDenormalized picks from the active
  // rows at call time, so reactivating first would let a not-yet-reclassified
  // row become a brand's hero and make the live run diverge from its preview.
  // Running after means the other passes execute exactly as reported.
  await applyReactivations(supabase, reactivationPlan, live)

  console.log('\n--- Repair Summary ---')
  console.log(`Dangling rows rejected: ${danglingRows.length}`)
  console.log(`Hotlink rows deleted:   ${externalRows.length}`)
  console.log(`Junk rows rejected:     ${junkRows.length}`)
  console.log(`Logo rows kept:         ${excludedLogoRows.length}`)
  console.log(
    `Null-verdict reactivated: ${rowsToReactivate.length} of ${reactivationCandidates.length} candidate(s)`,
  )
  console.log(`Brands hidden:          ${brandsToHide.length}`)
  console.log(`Heroes resynced:        ${heroCounts.sync}`)
  console.log(`Heroes kept (live url): ${heroCounts.keep}`)
  console.log(`Heroes cleared:         ${heroCounts.clear}`)
  console.log(`Heroes skipped:         ${heroCounts.skip}`)
  console.log(`Manifest:               ${outputPath}`)
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  await repair(options)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
