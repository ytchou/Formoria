import {
  applyPendingCommunityStockistFilter,
  applyPublicStockistVisibility,
  groupStockistsForDisplay,
  matchesStockistKey,
  normalizeStockistName,
  stockistMatchKey,
  type StockistIdentity,
  type StockistMatchKey,
} from '@/lib/brands/stockist-display'
import { auditedCall } from '@/lib/audit'
import { parseSubmissionStockists } from '@/lib/types/enriched-data'
import type {
  StockistInput,
  StockistCandidate,
  StockistLocationType,
  StockistSource,
} from '@/lib/types/stockist'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import {
  CITY_SLUGS,
  CITY_NAMES_ZH,
  citySlugFromName,
  type CitySlug,
} from '@/lib/constants/taiwan-cities'
import { matchDistrict } from '@/lib/brands/district'

export const MAX_ACTIVE_STOCKISTS_PER_BRAND = 5

/** The slice of the Supabase client the enriched-stockist writers touch. */
export type StockistsSupabase = Pick<SupabaseClient, 'from' | 'rpc'>

function stockistsClient(client?: StockistsSupabase): StockistsSupabase {
  return client ?? (createServiceClient() as unknown as StockistsSupabase)
}
const MAX_SUBMISSIONS_PER_DAY = 20

const REGION_LABEL_MAP = CITY_NAMES_ZH

type SubmitStockistErrorCode =
  | 'invalid_name'
  | 'invalid_region'
  | 'invalid_url'
  | 'active_cap_reached'
  | 'daily_cap_reached'
  | 'duplicate_name'
  | 'database_error'

type SubmitStockistResult =
  { ok: true; id: string } | { ok: false; code: SubmitStockistErrorCode }

type EnrichedStockistsResult =
  | {
      ok: true
      /** Rows the RPC inserted or updated. */
      count: number
      /** Rows sent to the RPC. */
      resolvedCount: number
      /** Candidates dropped for a blank or over-long name. */
      invalidCount: number
      /** Candidates dropped as the same store as another candidate in the batch. */
      nearDuplicateCount: number
      /**
       * Resolved rows that land on an existing rejected or removed row. The RPC
       * leaves those untouched and does not count them, so
       * `count === resolvedCount - blockedCount` when nothing raced the write.
       */
      blockedCount: number
    }
  | { ok: false; code: 'database_error' | 'invalid_name' }

type StockistTableRow = {
  id: string
  brand_id: string
  name: string
  region_label: string | null
  address: string | null
  url: string | null
  source_url: string | null
  fetched_at: string | null
  location_type: string | null
  country: string | null
  owner_status: string
  owner_status_by: string | null
  source: string
  removed_at: string | null
}

type StockistLookupRow = Pick<StockistTableRow, 'brand_id'> & {
  region_label?: string | null
}

type EnrichedStockistRow = {
  name: string
  normalized_name: string
  region_label: string | null
  address: string | null
  url: string | null
  source?: StockistSource
  source_url?: string | null
  fetched_at?: string | null
  location_type?: StockistLocationType | null
  country?: string | null
  district?: string | null
  last_confirmed_at?: string | null
  provider_metadata?: Record<string, unknown> | null
}

type StockistDistrictBackfillRow = {
  id: string
  address: string
  regionLabel: string | null
  district: string | null
}

export const STOCKIST_DETAIL_READ_SELECT =
  'id, name, region_label, address, url, source_url, fetched_at, location_type, country, owner_status, owner_status_by, source, removed_at'

export async function listStockistDistrictBackfillRows(): Promise<
  StockistDistrictBackfillRow[]
> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brand_channels')
    .select('id, address, region_label, district')
    .eq('country', 'TW')
    .is('removed_at', null)
    .not('address', 'is', null)

  if (error) throw error
  return (
    (data ?? []) as Array<{
      id: string
      address: string
      region_label: string | null
      district: string | null
    }>
  ).map((row) => ({
    id: row.id,
    address: row.address,
    regionLabel: row.region_label,
    district: row.district,
  }))
}

export async function updateStockistDistricts(
  rows: Array<{ id: string; district: string | null }>,
): Promise<void> {
  if (rows.length === 0) return
  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc('update_brand_channel_districts', {
    p_updates: rows,
  })
  if (error) throw error
  if (data !== rows.length) {
    throw new Error(`Updated ${data} of ${rows.length} stockist districts`)
  }
}

function isMissingDistrictColumnError(error: unknown): boolean {
  if (!isRecord(error)) return false
  return (
    error.code === '42703' &&
    typeof error.message === 'string' &&
    error.message.includes('brand_channels.district')
  )
}

function trimNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function regionSlugToLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return REGION_LABEL_MAP[trimmed] ?? trimmed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function rowToDisplayRow(row: StockistTableRow) {
  return {
    id: row.id,
    name: row.name,
    regionLabel: row.region_label,
    address: row.address,
    url: row.url,
    sourceUrl: row.source_url,
    fetchedAt: row.fetched_at,
    locationType: row.location_type,
    country: row.country,
    ownerStatus: row.owner_status,
    ownerStatusBy: row.owner_status_by,
    source: row.source,
    removedAt: row.removed_at,
  }
}

function isDuplicateNameError(
  error: { code?: string; message?: string } | null,
): boolean {
  return (
    error?.code === '23505' ||
    error?.message?.toLowerCase().includes('normalized_name') === true
  )
}

/**
 * How many stockists the brand page actually shows.
 *
 * `applyPublicStockistVisibility`, not a hand-written pair of filters: the cap
 * this feeds is refused with 此品牌的實體通路已達上限, a sentence the reader
 * checks against the list in front of them. Counting rows the public read hides
 * — a pending community submission is hidden until an admin approves it — lets
 * one signed-in account wedge any brand with 5 invisible submissions, locking
 * out the brand's own owner against a page that lists three.
 */
async function countActiveStockists(brandId: string): Promise<number> {
  const supabase = createServiceClient()
  const { count, error } = await applyPublicStockistVisibility(
    supabase
      .from('brand_channels')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId),
  )

  if (error) throw error
  return count ?? 0
}

async function countRecentSubmissions(userId: string): Promise<number> {
  const submittedAfter = new Date(
    Date.now() - 24 * 60 * 60 * 1000,
  ).toISOString()
  const supabase = createServiceClient()
  const { count, error } = await supabase
    .from('brand_channels')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', userId)
    .eq('source', 'community')
    .gte('created_at', submittedAfter)

  if (error) throw error
  return count ?? 0
}

export async function getStockistsForBrand(
  brandId: string,
): Promise<ReturnType<typeof groupStockistsForDisplay>> {
  const supabase = createServiceClient()
  const { data, error } = await applyPublicStockistVisibility(
    supabase
      .from('brand_channels')
      .select(STOCKIST_DETAIL_READ_SELECT)
      .eq('brand_id', brandId),
  )

  if (error) throw error

  const displayRows = ((data ?? []) as unknown as StockistTableRow[]).map(
    rowToDisplayRow,
  )
  return groupStockistsForDisplay(displayRows)
}

/**
 * Every `brand_channels` row of this brand, in the shape
 * `resolveEnrichedStockistRows` matches against: the same read
 * `upsertEnrichedStockists` makes, so the FAQ's where-to-buy count resolves
 * pending candidates exactly as the upsert will (DEV-1928, DEV-1942).
 */
export async function getStockistMatchPool(
  brandId: string,
): Promise<ExistingStockistRow[]> {
  const rows = await readExistingStockistRows(stockistsClient(), brandId)
  if (!rows) throw new Error(`getStockistMatchPool: read failed for ${brandId}`)
  return rows
}

export async function submitStockist(
  userId: string,
  brandId: string,
  input: StockistInput,
): Promise<SubmitStockistResult> {
  return auditedCall(
    { provider: 'brands', operation: 'submitStockist', kind: 'service' },
    async () => {
      const name = input.name.trim()
      if (name.length < 1 || name.length > 80) {
        return { ok: false, code: 'invalid_name' }
      }

      const url = trimNullable(input.url)
      if (url && !/^https?:\/\/\S+$/i.test(url)) {
        return { ok: false, code: 'invalid_url' }
      }

      try {
        // Two counts over different keys with no shared input: the successful
        // path pays one round trip instead of two. The ORDER of the checks is
        // preserved on purpose — a submission that trips both caps still
        // reports `active_cap_reached`, which is the one the reader can act on.
        const [activeStockists, recentSubmissions] = await Promise.all([
          countActiveStockists(brandId),
          countRecentSubmissions(userId),
        ])
        if (activeStockists >= MAX_ACTIVE_STOCKISTS_PER_BRAND) {
          return { ok: false, code: 'active_cap_reached' }
        }
        if (recentSubmissions >= MAX_SUBMISSIONS_PER_DAY) {
          return { ok: false, code: 'daily_cap_reached' }
        }
      } catch {
        return { ok: false, code: 'database_error' }
      }

      const supabase = createServiceClient()
      const regionLabel = regionSlugToLabel(input.region)
      // A row with no resolvable region is grouped as `overseas` for display, and
      // the submit dialog only ever offers Taiwan regions — so an unresolved
      // region here means a Taiwanese shop would publish under 海外. The dialog
      // marks the field required, but `required` is a browser courtesy: this is
      // the check a non-browser caller cannot skip.
      if (regionLabel == null) {
        return { ok: false, code: 'invalid_region' }
      }
      const regionValue = input.region?.trim()
      const city =
        CITY_SLUGS.find((slug) => slug === regionValue) ??
        citySlugFromName(regionLabel)
      const address = trimNullable(input.address)
      const district = city && address ? matchDistrict(address, city) : null
      const insertPayload = {
        brand_id: brandId,
        name,
        normalized_name: normalizeStockistName(name),
        region_label: regionLabel,
        address,
        url,
        country: city ? 'TW' : null,
        source: 'community' as const,
        created_by: userId,
      }
      const insertStockist = (includeDistrict: boolean) => {
        if (includeDistrict) {
          return supabase
            .from('brand_channels')
            .insert({ ...insertPayload, district })
            .select('id')
            .single()
        }
        return supabase
          .from('brand_channels')
          .insert(insertPayload)
          .select('id')
          .single()
      }

      let insertResult = await insertStockist(district !== null)
      if (isMissingDistrictColumnError(insertResult.error)) {
        insertResult = await insertStockist(false)
      }
      const { data, error } = insertResult

      if (error) {
        if (isDuplicateNameError(error))
          return { ok: false, code: 'duplicate_name' }
        return { ok: false, code: 'database_error' }
      }

      const stockistId = (data as { id?: unknown } | null)?.id
      if (typeof stockistId !== 'string') {
        return { ok: false, code: 'database_error' }
      }

      // The row is invisible to the public until an admin approves it in
      // `/admin/stockists`; nothing else happens at submit time.
      return { ok: true, id: stockistId }
    },
  )
}

/**
 * One community submission awaiting an admin decision.
 *
 * Flat and brand-joined on purpose: the queue is cross-brand, so a reviewer
 * needs the brand beside the shop name to judge whether the claim is plausible
 * at all.
 */
export type PendingStockist = {
  id: string
  brandId: string
  brandSlug: string
  brandName: string
  name: string
  regionLabel: string | null
  address: string | null
  url: string | null
  submittedAt: string
}

type PendingStockistRow = {
  id: string
  brand_id: string
  name: string
  region_label: string | null
  address: string | null
  url: string | null
  created_at: string
  brands:
    | { slug: string; name: string }
    | Array<{ slug: string; name: string }>
    | null
}

export type StockistReviewResult =
  /**
   * `brandId` travels with the slug because the caller audits the decision:
   * `admin_audit_log.target_brand_id` is the column that survives a brand
   * rename, and the row is the only record that a stranger's claim was
   * published onto this brand.
   */
  | { ok: true; brandId: string; brandSlug: string; city: CitySlug | null }
  | { ok: false; code: 'not_found' | 'invalid_status' | 'database_error' }

/**
 * The admin queue behind `/admin/stockists`.
 *
 * Exactly the rows `PENDING_COMMUNITY_EXCLUSION` hides from the public: a
 * community submission with no decision on it. Anything an owner or an admin
 * has already decided is out of the queue by construction, so a row cannot be
 * approved twice.
 */
export async function listPendingCommunityStockists(): Promise<
  PendingStockist[]
> {
  const supabase = createServiceClient()
  const { data, error } = await applyPendingCommunityStockistFilter(
    supabase
      .from('brand_channels')
      .select(
        'id, brand_id, name, region_label, address, url, created_at, brands!inner(slug, name)',
      ),
  ).order('created_at', { ascending: true })

  if (error) throw error

  return ((data ?? []) as unknown as PendingStockistRow[]).flatMap((row) => {
    const brand = Array.isArray(row.brands) ? row.brands.at(0) : row.brands
    if (!brand) return []
    return [
      {
        id: row.id,
        brandId: row.brand_id,
        brandSlug: brand.slug,
        brandName: brand.name,
        name: row.name,
        regionLabel: row.region_label,
        address: row.address,
        url: row.url,
        submittedAt: row.created_at,
      },
    ]
  })
}

/**
 * An admin's decision on a community submission.
 *
 * `owner_status_by` records the ADMIN, not the brand. That is what stops the
 * public page from printing 品牌確認 over a row the brand never touched — see
 * `groupStockistsForDisplay`, which reads exactly this field to choose between
 * the owner and the Formoria label.
 */
export async function reviewCommunityStockist(
  stockistId: string,
  status: 'confirmed' | 'rejected',
  adminUserId: string,
): Promise<StockistReviewResult> {
  return auditedCall(
    {
      provider: 'brands',
      operation: 'reviewCommunityStockist',
      kind: 'service',
    },
    async () => {
      if (status !== 'confirmed' && status !== 'rejected') {
        return { ok: false, code: 'invalid_status' }
      }

      const supabase = createServiceClient()
      // The same three conditions the queue read and the queue badge use, from
      // one definition: this is the write, so a forgotten `removed_at is null`
      // here approves a tombstoned row straight onto a public brand page.
      const { data, error } = await applyPendingCommunityStockistFilter(
        supabase
          .from('brand_channels')
          .update({
            owner_status: status,
            owner_status_by: adminUserId,
          })
          .eq('id', stockistId),
      )
        .select('brand_id, region_label, brands!inner(slug)')
        .maybeSingle()

      if (error) return { ok: false, code: 'database_error' }
      if (!data) return { ok: false, code: 'not_found' }

      const row = data as unknown as StockistLookupRow & {
        brands: { slug: string } | Array<{ slug: string }> | null
      }
      const brand = Array.isArray(row.brands) ? row.brands.at(0) : row.brands
      if (!brand) return { ok: false, code: 'not_found' }

      return {
        ok: true,
        brandId: row.brand_id,
        brandSlug: brand.slug,
        city: citySlugFromName(row.region_label),
      }
    },
  )
}

export function buildEnrichedStockistRows(
  candidates: readonly StockistCandidate[],
): {
  rows: EnrichedStockistRow[]
  invalidCount: number
} {
  const rows: EnrichedStockistRow[] = []
  let invalidCount = 0
  for (const candidate of candidates) {
    const name = candidate.name.trim()
    const normalizedName =
      candidate.normalizedName.trim() || normalizeStockistName(name)
    if (
      name.length < 1 ||
      name.length > 80 ||
      normalizedName.length < 1 ||
      normalizedName.length > 80
    ) {
      invalidCount++
      continue
    }

    rows.push({
      name,
      normalized_name: normalizedName,
      region_label: trimNullable(candidate.regionLabel),
      address: trimNullable(candidate.address),
      url: trimNullable(candidate.url),
      source: candidate.source ?? 'enriched',
      source_url: trimNullable(candidate.sourceUrl),
      fetched_at: trimNullable(candidate.fetchedAt),
      location_type: candidate.locationType ?? null,
      country: trimNullable(candidate.country),
      district: trimNullable(candidate.district),
      last_confirmed_at: trimNullable(candidate.lastConfirmedAt),
      provider_metadata: candidate.providerMetadata ?? null,
    })
  }

  return { rows, invalidCount }
}

/** The `brand_channels` columns stockist matching reads (all NOT NULL but `address` and `removed_at`). */
export type ExistingStockistRow = {
  name: string
  normalized_name: string
  address: string | null
  source?: string
  owner_status?: string
  removed_at?: string | null
}

const EXISTING_STOCKIST_SELECT =
  'name, normalized_name, address, source, owner_status, removed_at'
const EXISTING_STOCKIST_PAGE_SIZE = 1000

/**
 * Every row of one brand, paged past PostgREST's 1000-row `db-max-rows` cap.
 * `normalized_name` is unique per brand, so ordering on it keeps `.range()`
 * pages from repeating or skipping a row. Null on a read error.
 */
async function readExistingStockistRows(
  supabase: StockistsSupabase,
  brandId: string,
): Promise<ExistingStockistRow[] | null> {
  const rows: ExistingStockistRow[] = []
  for (let from = 0; ; from += EXISTING_STOCKIST_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('brand_channels')
      .select(EXISTING_STOCKIST_SELECT)
      .eq('brand_id', brandId)
      .order('normalized_name')
      .range(from, from + EXISTING_STOCKIST_PAGE_SIZE - 1)
    if (error) return null
    const page = (data ?? []) as ExistingStockistRow[]
    rows.push(...page)
    if (page.length < EXISTING_STOCKIST_PAGE_SIZE) return rows
  }
}

function toStockistIdentity(
  row: Pick<ExistingStockistRow, 'name' | 'normalized_name' | 'address'>,
): StockistIdentity {
  return {
    name: row.name,
    normalizedName: row.normalized_name,
    address: row.address,
  }
}

/** Mirrors `applyPendingCommunityStockistFilter` minus `removed_at`, per DEV-1942. */
function isPendingCommunity(row: ExistingStockistRow): boolean {
  return row.source === 'community' && row.owner_status === 'none'
}

/** The rows `upsert_enriched_brand_channels` refuses to update. */
function isBlocked(row: ExistingStockistRow): boolean {
  return row.owner_status === 'rejected' || row.removed_at != null
}

/** The columns `upsert_enriched_brand_channels` coalesces on conflict. */
const COALESCED_STOCKIST_COLUMNS = [
  'region_label',
  'district',
  'address',
  'url',
  'source_url',
  'fetched_at',
  'location_type',
  'country',
  'last_confirmed_at',
  'provider_metadata',
] as const satisfies readonly (keyof EnrichedStockistRow)[]

/** Fills each of `kept`'s null coalesced columns from `dropped`. */
function mergeCoalescedColumns(
  kept: EnrichedStockistRow,
  dropped: EnrichedStockistRow,
): void {
  const target = kept as Record<string, unknown>
  for (const column of COALESCED_STOCKIST_COLUMNS) {
    if (target[column] == null && dropped[column] != null) {
      target[column] = dropped[column]
    }
  }
}

export type StockistResolution = {
  /** The rows to send to the RPC. */
  rows: EnrichedStockistRow[]
  /** Candidates dropped as the same store as another candidate in the batch. */
  nearDuplicateCount: number
  /** `rows` that land on an existing rejected or removed row. */
  blockedCount: number
  /** `rows` that match no existing row: the RPC inserts them. */
  newRowCount: number
}

/**
 * Folds near-duplicate candidates onto the brand's existing rows (DEV-1942).
 *
 * Pass 1 matches each candidate to an existing row — the exact conflict key
 * first, then `isSameStockist` — and gives it that row's `normalized_name`, so
 * the RPC's `on conflict` path handles it: an active row is coalesce-filled, a
 * rejected or removed row is left untouched. A pending community row
 * (`source = 'community'`, `owner_status = 'none'`) is a stranger's unreviewed
 * claim: it takes exact conflict-key matches, as the RPC would, but no near
 * match, so it never absorbs an enriched store.
 *
 * Pass 2 takes the unmatched candidates, after every matched one is placed,
 * so a weaker near duplicate cannot claim an existing row's slot first. A
 * candidate naming the same store as a row already placed is dropped, and its
 * non-null coalesced columns fill the kept row's nulls.
 *
 * Misses fail toward a duplicate row, never a lost store: two rows without
 * addresses on both sides never near-match, so the import's region-suffixed
 * same-name stores (`withRegionSuffix` in `stockist-import/plan.ts`) all
 * survive.
 *
 * Ceiling: a pairwise scan, O(candidates × (existing + kept)) key
 * comparisons — fine for per-brand sets of hundreds. Index the keys by
 * normalized address if a brand reaches thousands of rows.
 */
export function resolveEnrichedStockistRows(
  rows: readonly EnrichedStockistRow[],
  existing: readonly ExistingStockistRow[],
): StockistResolution {
  const byName = new Map(existing.map((row) => [row.normalized_name, row]))
  const nearPool = existing
    .filter((row) => !isPendingCommunity(row))
    .map((row) => ({ row, key: stockistMatchKey(toStockistIdentity(row)) }))
  const candidates = rows.map((row) => ({
    row,
    key: stockistMatchKey(toStockistIdentity(row)),
    match: byName.get(row.normalized_name),
  }))
  for (const candidate of candidates) {
    if (candidate.match) continue
    candidate.match = nearPool.find((entry) =>
      matchesStockistKey(candidate.key, entry.key),
    )?.row
  }

  const kept: { row: EnrichedStockistRow; key: StockistMatchKey }[] = []
  let nearDuplicateCount = 0
  const place = (
    row: EnrichedStockistRow,
    key: StockistMatchKey,
    isTwin: (other: StockistMatchKey) => boolean,
  ) => {
    const twin = kept.find((entry) => isTwin(entry.key))
    if (twin) {
      mergeCoalescedColumns(twin.row, row)
      nearDuplicateCount += 1
      return
    }
    kept.push({ row, key })
  }
  // Two candidates matched to different existing rows stay two rows, even
  // when those existing rows are themselves near duplicates.
  for (const { row, key, match } of candidates) {
    if (!match) continue
    const normalizedName = match.normalized_name
    place(
      { ...row, normalized_name: normalizedName },
      { ...key, normalizedName },
      (other) => other.normalizedName === normalizedName,
    )
  }
  for (const { row, key, match } of candidates) {
    if (match) continue
    place({ ...row }, key, (other) => matchesStockistKey(key, other))
  }

  let blockedCount = 0
  let newRowCount = 0
  for (const { row } of kept) {
    const target = byName.get(row.normalized_name)
    if (!target) newRowCount += 1
    else if (isBlocked(target)) blockedCount += 1
  }
  return {
    rows: kept.map((entry) => entry.row),
    nearDuplicateCount,
    blockedCount,
    newRowCount,
  }
}

export async function upsertEnrichedStockists(
  brandId: string,
  candidates: StockistCandidate[],
  options: { client?: StockistsSupabase } = {},
): Promise<EnrichedStockistsResult> {
  return auditedCall(
    {
      provider: 'brands',
      operation: 'upsertEnrichedStockists',
      kind: 'service',
    },
    async () => {
      const { rows, invalidCount } = buildEnrichedStockistRows(candidates)

      if (rows.length === 0) {
        return invalidCount > 0
          ? { ok: false, code: 'invalid_name' }
          : {
              ok: true,
              count: 0,
              resolvedCount: 0,
              invalidCount: 0,
              nearDuplicateCount: 0,
              blockedCount: 0,
            }
      }

      const supabase = stockistsClient(options.client)
      // No status filter: a rejected or removed row must absorb its near
      // duplicate too, or the store the owner rejected comes back renamed.
      // Shortcut: read-then-RPC is not atomic. A row a concurrent writer adds
      // between the read and the RPC is not near-matched, so its near duplicate
      // inserts beside it — a duplicate row, never a lost store — and the
      // import's count check may throw. Move the matching into the RPC if
      // concurrent stockist writers appear.
      const existing = await readExistingStockistRows(supabase, brandId)
      if (!existing) return { ok: false, code: 'database_error' }
      const resolution = resolveEnrichedStockistRows(rows, existing)

      const { data, error } = await supabase.rpc(
        'upsert_enriched_brand_channels',
        {
          p_brand_id: brandId,
          p_candidates: resolution.rows,
        },
      )

      if (error) return { ok: false, code: 'database_error' }
      const count =
        typeof data === 'number'
          ? data
          : Array.isArray(data)
            ? data.length
            : resolution.rows.length - resolution.blockedCount
      return {
        ok: true,
        count,
        resolvedCount: resolution.rows.length,
        invalidCount,
        nearDuplicateCount: resolution.nearDuplicateCount,
        blockedCount: resolution.blockedCount,
      }
    },
  )
}

/**
 * Reads `enriched_data.stockists` from a submission row and materializes the
 * candidates into `brand_channels` (source='enriched') via
 * `upsertEnrichedStockists`. Mirrors `materializeSubmissionFaq`.
 *
 * Called at apply/approve time: enrichment only proposes stockists on the
 * submission, so nothing reaches the public brand page until a reviewer acts.
 * Returns null when the submission is missing or carries no stockists key.
 */
export async function materializeSubmissionStockists(
  submissionId: string,
  brandId: string,
  options: { client?: StockistsSupabase } = {},
): Promise<{ count: number } | null> {
  return auditedCall(
    {
      provider: 'brands',
      operation: 'materializeSubmissionStockists',
      kind: 'service',
    },
    async () => {
      const supabase = stockistsClient(options.client)
      const { data, error } = await supabase
        .from('brand_submissions')
        .select('enriched_data')
        .eq('id', submissionId)
        .single()

      if (error || !data) {
        console.warn(
          `materializeSubmissionStockists: submission ${submissionId} not found`,
        )
        return null
      }

      const enrichedData = (data as { enriched_data?: Record<string, unknown> })
        .enriched_data
      const candidates = parseSubmissionStockists(enrichedData?.stockists)
      if (!candidates) return null

      const result = await upsertEnrichedStockists(brandId, candidates, {
        client: options.client,
      })
      if (!result.ok) {
        throw new Error(
          `materializeSubmissionStockists: upsert failed (${result.code})`,
        )
      }
      return { count: result.count }
    },
  )
}
