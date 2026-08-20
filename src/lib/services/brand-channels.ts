import {
  applyPublicChannelVisibility,
  groupChannelsForDisplay,
  normalizeChannelName,
} from '@/lib/brands/channels'
import { auditedCall } from '@/lib/audit'
import type {
  BrandChannelInput,
  ChannelCandidate,
  ChannelLocationType,
  ChannelSource,
  ChannelType,
} from '@/lib/types/brand-channel'
import { unstable_cache } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import {
  CITY_SLUGS,
  CITY_NAMES_ZH,
  citySlugFromName,
  type CitySlug,
} from '@/lib/constants/taiwan-cities'
import { PUBLIC_BRAND_DATA_TAG } from '@/lib/cache/public-brand-cache'
import { TEST_BRAND_NAME_PATTERN } from './public-brand-filter'
import {
  matchSubcategory,
  subcategoryBySlug,
  L2_SUBCATEGORIES,
  L1_CATEGORIES,
} from '@/lib/taxonomy/ontology'
import { districtSlugFromName } from '@/lib/constants/taiwan-districts'
import { matchDistrict } from '@/lib/brands/district'
import { isOwnerOf, listBrandOwnerUserIds } from './brand-owners'

const MAX_ACTIVE_CHANNELS_PER_BRAND = 5
const MAX_SUBMISSIONS_PER_DAY = 20

const REGION_LABEL_MAP = CITY_NAMES_ZH

type SubmitChannelErrorCode =
  | 'invalid_name'
  | 'invalid_channel_type'
  | 'invalid_url'
  | 'active_cap_reached'
  | 'daily_cap_reached'
  | 'duplicate_name'
  | 'database_error'

export type SubmitChannelResult =
  { ok: true; id: string } | { ok: false; code: SubmitChannelErrorCode }

export type ChannelActionResult =
  | { ok: true; city?: CitySlug | null }
  | {
      ok: false
      code: 'not_found' | 'not_owner' | 'invalid_status' | 'database_error'
    }

export type EnrichedChannelsResult =
  | { ok: true; count: number }
  | { ok: false; code: 'database_error' | 'invalid_name' }

type BrandChannelRow = {
  id: string
  brand_id: string
  name: string
  channel_type: string
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

type ChannelLookupRow = Pick<BrandChannelRow, 'brand_id'> & {
  region_label?: string | null
}

type EnrichedChannelRow = {
  name: string
  normalized_name: string
  channel_type: ChannelType
  region_label: string | null
  address: string | null
  url: string | null
  source?: ChannelSource
  source_url?: string | null
  fetched_at?: string | null
  location_type?: ChannelLocationType | null
  country?: string | null
  district?: string | null
  last_confirmed_at?: string | null
  provider_metadata?: Record<string, unknown> | null
}

export type StockistLocation = {
  id: string
  name: string
  address: string | null
  url: string | null
  country: string | null
  city: CitySlug | null
  district: string | null
  brandSlug: string
  brandName: string
  categorySlug: string | null
  subcategories: string[]
}

export type StockistCitySummary = {
  city: CitySlug
  count: number
  districts: Array<{ name: string; slug: string; count: number }>
}

export type StockistDistrictGroup = {
  name: string | null
  slug: string
  locations: StockistLocation[]
}

type StockistReadRow = {
  id: string
  name: string
  address: string | null
  url: string | null
  country: string | null
  region_label: string | null
  district?: string | null
  brands:
    | {
        slug: string
        name: string
        category: string | null
        subcategories: unknown
        status: string
      }
    | Array<{
        slug: string
        name: string
        category: string | null
        subcategories: unknown
        status: string
      }>
}

type ChannelDistrictBackfillRow = {
  id: string
  address: string
  regionLabel: string | null
  district: string | null
}

export const CHANNEL_READ_SELECT =
  'id, name, channel_type, region_label, address, url, source_url, fetched_at, location_type, country, owner_status, owner_status_by, source, removed_at'

const STOCKIST_READ_SELECT =
  'id, name, address, url, country, region_label, district, brands!inner(slug, name, category, subcategories, status)'

const LEGACY_STOCKIST_READ_SELECT =
  'id, name, address, url, country, region_label, brands!inner(slug, name, category, subcategories, status)'

const STOCKIST_PAGE_SIZE = 1000

export function buildStockistPageRanges(
  total: number,
): Array<{ from: number; to: number }> {
  return Array.from(
    { length: Math.ceil(total / STOCKIST_PAGE_SIZE) },
    (_, index) => ({
      from: index * STOCKIST_PAGE_SIZE,
      to: Math.min(total, (index + 1) * STOCKIST_PAGE_SIZE) - 1,
    }),
  )
}

function mapStockistRow(row: StockistReadRow): StockistLocation | null {
  const brand = Array.isArray(row.brands) ? row.brands.at(0) : row.brands
  if (!brand) return null
  const city = row.country === 'TW' ? citySlugFromName(row.region_label) : null
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    url: row.url,
    country: row.country,
    city,
    district:
      row.district ??
      (city && row.address ? matchDistrict(row.address, city) : null),
    brandSlug: brand.slug,
    brandName: brand.name,
    categorySlug: brand.category,
    subcategories: Array.isArray(brand.subcategories)
      ? brand.subcategories.filter(
          (tag): tag is string => typeof tag === 'string',
        )
      : [],
  }
}

/** Exported for the slug-storage regression test; `getStockistDirectory` is the only runtime caller. */
export function matchesCategory(
  location: StockistLocation,
  category?: string,
): boolean {
  if (!category) return true
  if (location.categorySlug === category) return true
  const subcategory = subcategoryBySlug(category)
  return Boolean(
    subcategory &&
    location.subcategories.some(
      // Stored values are SLUGS since DEV-1510, so the slug map is tried
      // first; `matchSubcategory` is the fallback for any row still holding a
      // pre-migration zh-TW label. Slug-only lookup through `matchSubcategory`
      // resolves none of the 117 multi-word slugs ('tote-bags'), which reads as
      // an empty stockist list rather than an error. Same order as
      // `resolveSubcategorySelection`.
      (tag) =>
        (subcategoryBySlug(tag) ?? matchSubcategory(tag))?.slug ===
        subcategory.slug,
    ),
  )
}

export function resolveStockistCategory(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const validCategories = [
    ...L1_CATEGORIES.map((category) => category.slug),
    ...L2_SUBCATEGORIES.map((subcategory) => subcategory.slug),
  ]
  return validCategories.includes(value) ? value : undefined
}

export function summarizeStockistCities(
  locations: StockistLocation[],
): StockistCitySummary[] {
  const byCity = new Map<CitySlug, StockistLocation[]>()
  for (const location of locations) {
    if (!location.city) continue
    const cityLocations = byCity.get(location.city) ?? []
    cityLocations.push(location)
    byCity.set(location.city, cityLocations)
  }

  return [...byCity.entries()]
    .map(([city, cityLocations]) => {
      const counts = new Map<string, number>()
      for (const location of cityLocations) {
        if (location.district) {
          counts.set(
            location.district,
            (counts.get(location.district) ?? 0) + 1,
          )
        }
      }
      return {
        city,
        count: cityLocations.length,
        districts: [...counts.entries()]
          .flatMap(([name, count]) => {
            const slug = districtSlugFromName(city, name)
            return slug ? [{ name, slug, count }] : []
          })
          .sort(
            (left, right) =>
              right.count - left.count || left.name.localeCompare(right.name),
          ),
      }
    })
    .sort((left, right) => right.count - left.count)
}

export function groupStockistsForCity(
  locations: StockistLocation[],
  city: CitySlug,
): StockistDistrictGroup[] {
  const groups = new Map<string | null, StockistLocation[]>()
  for (const location of locations) {
    if (location.city !== city) continue
    const districtLocations = groups.get(location.district) ?? []
    districtLocations.push(location)
    groups.set(location.district, districtLocations)
  }

  const assigned = [...groups.entries()]
    .filter((entry): entry is [string, StockistLocation[]] => Boolean(entry[0]))
    .flatMap(([name, districtLocations]) => {
      const slug = districtSlugFromName(city, name)
      return slug ? [{ name, slug, locations: districtLocations }] : []
    })
    .sort(
      (left, right) =>
        right.locations.length - left.locations.length ||
        left.name.localeCompare(right.name),
    )
  const unassigned = groups.get(null)
  return unassigned
    ? [...assigned, { name: null, slug: 'unassigned', locations: unassigned }]
    : assigned
}

export function stockistDistrictSlugs(locations: StockistLocation[]): string[] {
  return [
    ...new Set(
      locations.flatMap((location) => {
        if (!location.city || !location.district) return []
        const slug = districtSlugFromName(location.city, location.district)
        return slug ? [slug] : []
      }),
    ),
  ]
}

function isMissingDistrictColumnError(error: unknown): boolean {
  if (!isRecord(error)) return false
  return (
    error.code === '42703' &&
    typeof error.message === 'string' &&
    error.message.includes('brand_channels.district')
  )
}

/**
 * Both queries below apply `applyPublicChannelVisibility`, and both have to: a
 * filter on the first page only hides nothing past row 1000, and no type
 * checker can see the difference. `brand-channels.test.ts` pins the count at
 * two.
 */
async function fetchStockistRows(select: string): Promise<StockistReadRow[]> {
  const supabase = createServiceClient()
  const { data, error, count } = await applyPublicChannelVisibility(
    supabase
      .from('brand_channels')
      .select(select, { count: 'exact' })
      .eq('brands.status', 'approved')
      .not('brands.name', 'like', TEST_BRAND_NAME_PATTERN)
      .eq('channel_type', 'offline'),
  )
    .order('region_label')
    .order('name')
    .order('id')
    .range(0, STOCKIST_PAGE_SIZE - 1)

  if (error) throw error
  if (count === null)
    throw new Error('Stockist directory query returned no exact count')

  const remainingPages = await Promise.all(
    buildStockistPageRanges(count)
      .slice(1)
      .map(async ({ from, to }) => {
        const { data: page, error: pageError } = await applyPublicChannelVisibility(
          supabase
            .from('brand_channels')
            .select(select)
            .eq('brands.status', 'approved')
            .not('brands.name', 'like', TEST_BRAND_NAME_PATTERN)
            .eq('channel_type', 'offline'),
        )
          .order('region_label')
          .order('name')
          .order('id')
          .range(from, to)
        if (pageError) throw pageError
        return page ?? []
      }),
  )

  return [
    ...(data ?? []),
    ...remainingPages.flat(),
  ] as unknown as StockistReadRow[]
}

export const getStockistDirectory = unstable_cache(
  async (category?: string): Promise<StockistLocation[]> => {
    let rows: StockistReadRow[]
    try {
      rows = await fetchStockistRows(STOCKIST_READ_SELECT)
    } catch (error) {
      if (!isMissingDistrictColumnError(error)) throw error
      rows = await fetchStockistRows(LEGACY_STOCKIST_READ_SELECT)
    }

    return rows
      .map(mapStockistRow)
      .filter((location): location is StockistLocation => Boolean(location))
      .filter((location) => matchesCategory(location, category))
  },
  ['stockist-directory'],
  { revalidate: 3600, tags: [PUBLIC_BRAND_DATA_TAG] },
)

export async function listChannelDistrictBackfillRows(): Promise<
  ChannelDistrictBackfillRow[]
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

export async function updateChannelDistricts(
  rows: Array<{ id: string; district: string | null }>,
): Promise<void> {
  if (rows.length === 0) return
  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc('update_brand_channel_districts', {
    p_updates: rows,
  })
  if (error) throw error
  if (data !== rows.length) {
    throw new Error(`Updated ${data} of ${rows.length} channel districts`)
  }
}

function isChannelType(value: string): value is ChannelType {
  return value === 'online' || value === 'offline'
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

function rowToDisplayRow(row: BrandChannelRow) {
  return {
    id: row.id,
    name: row.name,
    channelType: row.channel_type,
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

async function countActiveChannels(brandId: string): Promise<number> {
  const supabase = createServiceClient()
  const { count, error } = await supabase
    .from('brand_channels')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .is('removed_at', null)
    .neq('owner_status', 'rejected')

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

export async function getChannelsForBrand(
  brandId: string,
): Promise<ReturnType<typeof groupChannelsForDisplay>> {
  const supabase = createServiceClient()
  const { data, error } = await applyPublicChannelVisibility(
    supabase
      .from('brand_channels')
      .select(CHANNEL_READ_SELECT)
      .eq('brand_id', brandId),
  )

  if (error) throw error

  const rows = (data ?? []) as unknown as BrandChannelRow[]
  // The owners are read even when no row is owner-confirmed: the alternative is
  // a conditional read whose skip path silently relabels 站方確認 as 品牌確認.
  const brandOwnerUserIds = await listBrandOwnerUserIds(brandId)

  return groupChannelsForDisplay(rows.map(rowToDisplayRow), brandOwnerUserIds)
}

export async function submitChannel(
  userId: string,
  brandId: string,
  input: BrandChannelInput,
): Promise<SubmitChannelResult> {
  return auditedCall(
    { provider: 'brands', operation: 'submitChannel', kind: 'service' },
    async () => {
      const name = input.name.trim()
      if (name.length < 1 || name.length > 80) {
        return { ok: false, code: 'invalid_name' }
      }
      if (!isChannelType(input.channelType)) {
        return { ok: false, code: 'invalid_channel_type' }
      }

      const url = trimNullable(input.url)
      if (url && !/^https?:\/\/\S+$/i.test(url)) {
        return { ok: false, code: 'invalid_url' }
      }

      try {
        if (
          (await countActiveChannels(brandId)) >= MAX_ACTIVE_CHANNELS_PER_BRAND
        ) {
          return { ok: false, code: 'active_cap_reached' }
        }
        if ((await countRecentSubmissions(userId)) >= MAX_SUBMISSIONS_PER_DAY) {
          return { ok: false, code: 'daily_cap_reached' }
        }
      } catch {
        return { ok: false, code: 'database_error' }
      }

      const supabase = createServiceClient()
      const regionLabel = regionSlugToLabel(input.region)
      const regionValue = input.region?.trim()
      const city =
        CITY_SLUGS.find((slug) => slug === regionValue) ??
        citySlugFromName(regionLabel)
      const address = trimNullable(input.address)
      const district = city && address ? matchDistrict(address, city) : null
      const insertPayload = {
        brand_id: brandId,
        name,
        normalized_name: normalizeChannelName(name),
        channel_type: input.channelType,
        region_label: regionLabel,
        address,
        url,
        country: city ? 'TW' : null,
        source: 'community' as const,
        created_by: userId,
      }
      const insertChannel = (includeDistrict: boolean) => {
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

      let insertResult = await insertChannel(district !== null)
      if (isMissingDistrictColumnError(insertResult.error)) {
        insertResult = await insertChannel(false)
      }
      const { data, error } = insertResult

      if (error) {
        if (isDuplicateNameError(error))
          return { ok: false, code: 'duplicate_name' }
        return { ok: false, code: 'database_error' }
      }

      const channelId = (data as { id?: unknown } | null)?.id
      if (typeof channelId !== 'string') {
        return { ok: false, code: 'database_error' }
      }

      // The row is invisible to the public until an admin approves it in
      // `/admin/stockists`; nothing else happens at submit time.
      return { ok: true, id: channelId }
    },
  )
}

export async function setOwnerChannelStatus(
  userId: string,
  channelId: string,
  status: 'confirmed' | 'rejected',
): Promise<ChannelActionResult> {
  return auditedCall(
    { provider: 'brands', operation: 'setOwnerChannelStatus', kind: 'service' },
    async () => {
      if (status !== 'confirmed' && status !== 'rejected') {
        return { ok: false, code: 'invalid_status' }
      }

      const supabase = createServiceClient()
      const { data: channel, error: lookupError } = await supabase
        .from('brand_channels')
        .select('brand_id, region_label')
        .eq('id', channelId)
        .maybeSingle()

      if (lookupError) return { ok: false, code: 'database_error' }
      if (!channel) return { ok: false, code: 'not_found' }

      const { brand_id: brandId } = channel as unknown as ChannelLookupRow
      if (!(await isOwnerOf(userId, brandId))) {
        return { ok: false, code: 'not_owner' }
      }

      const { error: updateError } = await supabase
        .from('brand_channels')
        .update({
          owner_status: status,
          owner_status_by: userId,
        })
        .eq('id', channelId)

      if (updateError) return { ok: false, code: 'database_error' }
      return {
        ok: true,
        city: citySlugFromName((channel as ChannelLookupRow).region_label),
      }
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
  channelType: ChannelType
  regionLabel: string | null
  address: string | null
  url: string | null
  submittedAt: string
}

type PendingStockistRow = {
  id: string
  brand_id: string
  name: string
  channel_type: string
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
  | { ok: true; brandSlug: string; city: CitySlug | null }
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
  const { data, error } = await supabase
    .from('brand_channels')
    .select(
      'id, brand_id, name, channel_type, region_label, address, url, created_at, brands!inner(slug, name)',
    )
    .eq('source', 'community')
    .eq('owner_status', 'none')
    .is('removed_at', null)
    .order('created_at', { ascending: true })

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
        channelType: row.channel_type as ChannelType,
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
 * `groupChannelsForDisplay`, which reads exactly this field to choose between
 * the owner and the Formoria label.
 */
export async function reviewCommunityStockist(
  channelId: string,
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
      const { data, error } = await supabase
        .from('brand_channels')
        .update({
          owner_status: status,
          owner_status_by: adminUserId,
        })
        .eq('id', channelId)
        .eq('source', 'community')
        .eq('owner_status', 'none')
        .select('brand_id, region_label, brands!inner(slug)')
        .maybeSingle()

      if (error) return { ok: false, code: 'database_error' }
      if (!data) return { ok: false, code: 'not_found' }

      const row = data as unknown as ChannelLookupRow & {
        brands: { slug: string } | Array<{ slug: string }> | null
      }
      const brand = Array.isArray(row.brands) ? row.brands.at(0) : row.brands
      if (!brand) return { ok: false, code: 'not_found' }

      return {
        ok: true,
        brandSlug: brand.slug,
        city: citySlugFromName(row.region_label),
      }
    },
  )
}

export function buildEnrichedChannelRows(candidates: ChannelCandidate[]): {
  rows: EnrichedChannelRow[]
  invalidCount: number
} {
  const rows: EnrichedChannelRow[] = []
  let invalidCount = 0
  for (const candidate of candidates) {
    const name = candidate.name.trim()
    const normalizedName =
      candidate.normalizedName.trim() || normalizeChannelName(name)
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
      channel_type: candidate.channelType,
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

export async function upsertEnrichedChannels(
  brandId: string,
  candidates: ChannelCandidate[],
): Promise<EnrichedChannelsResult> {
  return auditedCall(
    {
      provider: 'brands',
      operation: 'upsertEnrichedChannels',
      kind: 'service',
    },
    async () => {
      const { rows, invalidCount } = buildEnrichedChannelRows(candidates)

      if (rows.length === 0) {
        return invalidCount > 0
          ? { ok: false, code: 'invalid_name' }
          : { ok: true, count: 0 }
      }

      const supabase = createServiceClient()
      const { data, error } = await supabase.rpc(
        'upsert_enriched_brand_channels',
        {
          p_brand_id: brandId,
          p_candidates: rows,
        },
      )

      if (error) return { ok: false, code: 'database_error' }
      const count =
        typeof data === 'number'
          ? data
          : Array.isArray(data)
            ? data.length
            : rows.length
      return { ok: true, count }
    },
  )
}
