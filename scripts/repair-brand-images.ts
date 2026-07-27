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
 * `logo` is a junk tag for hero selection but not for keeping: the 4 logo-tagged
 * rows are high-confidence real brand marks (scores 70–90), and a clean logo
 * beats a letter tile for a brand whose only other option is the fallback.
 * Opt them in with --include-logos.
 */
const JUNK_TAGS_EXCLUDED_BY_DEFAULT = new Set(['logo'])

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
      '  Override: --force      (bypass the inventory safety check; only use',
      '                          after manually confirming the bucket listing',
      '                          is complete and the losses are expected)',
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
    if (!tags.some((tag) => JUNK_TAGS.has(tag))) continue

    const excludedOnly = tags.every(
      (tag) => !JUNK_TAGS.has(tag) || JUNK_TAGS_EXCLUDED_BY_DEFAULT.has(tag),
    )
    if (!includeLogos && excludedOnly) {
      excludedLogoRows.push(row)
      continue
    }
    junkRows.push(row)
  }

  return { junkRows, excludedLogoRows }
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

  const [rows, brands, objects] = await Promise.all([
    loadBrandImages(supabase),
    loadBrands(supabase),
    listAllObjects(supabase as unknown as StorageListClient),
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
  reportCounts(brandCounts, brandsToHide)
  reportHeroPlan(heroPlan)

  const anomalies = [
    ...detectInventoryAnomalies(objects.length, rows, danglingRows, slugById),
    ...detectJunkAnomalies(brandsToHide),
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
        `(${excludedLogoRows.length} logo row(s) excluded), hide ${brandsToHide.length} emptied brand(s), ` +
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

  console.log('\n--- Repair Summary ---')
  console.log(`Dangling rows rejected: ${danglingRows.length}`)
  console.log(`Hotlink rows deleted:   ${externalRows.length}`)
  console.log(`Junk rows rejected:     ${junkRows.length}`)
  console.log(`Logo rows kept:         ${excludedLogoRows.length}`)
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
