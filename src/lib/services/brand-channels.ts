import {
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
  CITY_NAMES_ZH,
  citySlugFromName,
  type CitySlug,
} from '@/lib/constants/taiwan-cities'
import { PUBLIC_BRAND_DATA_TAG } from '@/lib/cache/public-brand-cache'
import { TEST_BRAND_NAME_PATTERN } from './public-brand-filter'
import {
  matchSubcategory,
  subcategoryBySlug,
  PRODUCT_SUBCATEGORIES,
  PRODUCT_TYPE_CATEGORIES,
} from '@/lib/taxonomy/ontology'
import { districtSlugFromName } from '@/lib/constants/taiwan-districts'
import { logAdminAction } from './admin-audit'
import { isOwnerOf } from './brand-owners'

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
  | { ok: true }
  | {
      ok: false
      code: 'not_found' | 'not_owner' | 'invalid_status' | 'database_error'
    }

export type EnrichedChannelsResult =
  | { ok: true; count: number }
  | { ok: false; code: 'database_error' | 'invalid_name' }

type ConfirmationEmbed = {
  count?: number
  user_id?: string
}

type BrandChannelRow = {
  id: string
  brand_id: string
  name: string
  channel_type: string
  category_label: string | null
  region_label: string | null
  address: string | null
  url: string | null
  source_url: string | null
  fetched_at: string | null
  location_type: string | null
  country: string | null
  owner_status: string
  source: string
  removed_at: string | null
  brand_channel_confirmations?: ConfirmationEmbed[] | ConfirmationEmbed | null
}

type ChannelLookupRow = Pick<BrandChannelRow, 'brand_id'>

type EnrichedChannelRow = {
  name: string
  normalized_name: string
  channel_type: ChannelType
  category_label: string | null
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
  productType: string | null
  productTags: string[]
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
  district: string | null
  brands:
    | {
        slug: string
        name: string
        product_type: string | null
        product_tags: unknown
        status: string
      }
    | Array<{
        slug: string
        name: string
        product_type: string | null
        product_tags: unknown
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
  'id, name, channel_type, category_label, region_label, address, url, source_url, fetched_at, location_type, country, owner_status, source, removed_at, brand_channel_confirmations(count)'

export const STOCKIST_READ_SELECT =
  'id, name, address, url, country, region_label, district, brands!inner(slug, name, product_type, product_tags, status)'

function mapStockistRow(row: StockistReadRow): StockistLocation | null {
  const brand = Array.isArray(row.brands) ? row.brands.at(0) : row.brands
  if (!brand) return null
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    url: row.url,
    country: row.country,
    city: row.country === 'TW' ? citySlugFromName(row.region_label) : null,
    district: row.district,
    brandSlug: brand.slug,
    brandName: brand.name,
    productType: brand.product_type,
    productTags: Array.isArray(brand.product_tags)
      ? brand.product_tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
  }
}

function matchesCategory(location: StockistLocation, category?: string): boolean {
  if (!category) return true
  if (location.productType === category) return true
  const subcategory = subcategoryBySlug(category)
  return Boolean(
    subcategory &&
      location.productTags.some(
        (tag) => matchSubcategory(tag)?.slug === subcategory.slug,
      ),
  )
}

export function resolveStockistCategory(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const validCategories = [
    ...PRODUCT_TYPE_CATEGORIES.map((category) => category.slug),
    ...PRODUCT_SUBCATEGORIES.map((subcategory) => subcategory.slug),
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
          counts.set(location.district, (counts.get(location.district) ?? 0) + 1)
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

export const getStockistDirectory = unstable_cache(
  async (category?: string): Promise<StockistLocation[]> => {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('brand_channels')
      .select(STOCKIST_READ_SELECT)
      .eq('brands.status', 'approved')
      .not('brands.name', 'like', TEST_BRAND_NAME_PATTERN)
      .is('removed_at', null)
      .neq('owner_status', 'rejected')
      .order('region_label')
      .order('district')
      .order('name')

    if (error) throw error
    return ((data ?? []) as unknown as StockistReadRow[])
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
  return ((data ?? []) as Array<{
    id: string
    address: string
    region_label: string | null
    district: string | null
  }>).map((row) => ({
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
  const { error } = await supabase
    .from('brand_channels')
    .upsert(rows, { onConflict: 'id' })
  if (error) throw error
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

function confirmationDetails(value: unknown): {
  count: number
  userIds: string[]
} {
  const entries = Array.isArray(value)
    ? value.filter(isRecord)
    : isRecord(value)
      ? [value]
      : []
  const countEntry = entries.find((entry) => typeof entry.count === 'number')

  return {
    count:
      typeof countEntry?.count === 'number' ? countEntry.count : entries.length,
    userIds: entries.flatMap((entry) =>
      typeof entry.user_id === 'string' ? [entry.user_id] : [],
    ),
  }
}

function rowToDisplayRow(row: BrandChannelRow) {
  const confirmations = confirmationDetails(row.brand_channel_confirmations)
  return {
    displayRow: {
      id: row.id,
      name: row.name,
      channelType: row.channel_type,
      categoryLabel: row.category_label,
      regionLabel: row.region_label,
      address: row.address,
      url: row.url,
      sourceUrl: row.source_url,
      fetchedAt: row.fetched_at,
      locationType: row.location_type,
      country: row.country,
      ownerStatus: row.owner_status,
      source: row.source,
      confirmationCount: confirmations.count,
      removedAt: row.removed_at,
    },
    confirmationUserIds: confirmations.userIds,
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

async function countConfirmations(channelId: string): Promise<number> {
  const supabase = createServiceClient()
  const { count, error } = await supabase
    .from('brand_channel_confirmations')
    .select('id', { count: 'exact', head: true })
    .eq('channel_id', channelId)

  if (error) throw error
  return count ?? 0
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
  viewerUserId?: string,
): Promise<ReturnType<typeof groupChannelsForDisplay>> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brand_channels')
    .select(CHANNEL_READ_SELECT)
    .eq('brand_id', brandId)
    .is('removed_at', null)
    .neq('owner_status', 'rejected')

  if (error) throw error

  const rows = (data ?? []) as unknown as BrandChannelRow[]
  const displayRows = rows.map((row) => rowToDisplayRow(row).displayRow)

  let viewerConfirmedIds: string[] | undefined
  if (viewerUserId) {
    const channelIds = rows.map((row) => row.id)
    if (channelIds.length > 0) {
      const { data: viewerData, error: viewerError } = await supabase
        .from('brand_channel_confirmations')
        .select('channel_id')
        .eq('user_id', viewerUserId)
        .in('channel_id', channelIds)
      if (viewerError) throw viewerError
      viewerConfirmedIds = (viewerData ?? []).map(
        (row) => (row as { channel_id: string }).channel_id,
      )
    } else {
      viewerConfirmedIds = []
    }
  }

  return groupChannelsForDisplay(displayRows, viewerConfirmedIds)
}

export async function confirmChannel(
  userId: string,
  channelId: string,
): Promise<number> {
  return auditedCall(
    { provider: 'brands', operation: 'confirmChannel', kind: 'service' },
    async () => {
      const supabase = createServiceClient()

      const { data: channel, error: lookupError } = await supabase
        .from('brand_channels')
        .select('id')
        .eq('id', channelId)
        .is('removed_at', null)
        .neq('owner_status', 'rejected')
        .maybeSingle()

      // A failed lookup must surface as an action error; returning 0 here would read
      // to the caller as a successful write that simply changed nothing.
      if (lookupError) throw lookupError
      // Genuine miss: the channel was removed or the owner rejected it.
      if (!channel) return 0

      const { error } = await supabase
        .from('brand_channel_confirmations')
        .upsert(
          {
            channel_id: channelId,
            user_id: userId,
          },
          { onConflict: 'channel_id,user_id' },
        )

      if (error) throw error
      return countConfirmations(channelId)
    },
  )
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
      const { data, error } = await supabase
        .from('brand_channels')
        .insert({
          brand_id: brandId,
          name,
          normalized_name: normalizeChannelName(name),
          channel_type: input.channelType,
          category_label: trimNullable(input.category),
          region_label: regionSlugToLabel(input.region),
          address: trimNullable(input.address),
          url,
          source: 'community',
          created_by: userId,
        })
        .select('id')
        .single()

      if (error) {
        if (isDuplicateNameError(error))
          return { ok: false, code: 'duplicate_name' }
        return { ok: false, code: 'database_error' }
      }

      const channelId = (data as { id?: unknown } | null)?.id
      if (typeof channelId !== 'string') {
        return { ok: false, code: 'database_error' }
      }

      const { error: confirmationError } = await supabase
        .from('brand_channel_confirmations')
        .upsert(
          {
            channel_id: channelId,
            user_id: userId,
          },
          { onConflict: 'channel_id,user_id' },
        )

      if (confirmationError) return { ok: false, code: 'database_error' }
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
        .select('brand_id')
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
      return { ok: true }
    },
  )
}

export async function adminRemoveChannel(
  channelId: string,
  adminId: string,
  adminEmail: string,
): Promise<ChannelActionResult> {
  return auditedCall(
    { provider: 'brands', operation: 'adminRemoveChannel', kind: 'service' },
    async () => {
      const supabase = createServiceClient()
      const { data, error } = await supabase
        .from('brand_channels')
        .update({
          removed_at: new Date().toISOString(),
          removed_by: adminId,
        })
        .eq('id', channelId)
        .select('brand_id')
        .maybeSingle()

      if (error) return { ok: false, code: 'database_error' }
      if (!data) return { ok: false, code: 'not_found' }

      const { brand_id: brandId } = data as unknown as ChannelLookupRow
      await logAdminAction({
        adminUserId: adminId,
        adminEmail,
        action: 'channel_removed',
        targetBrandId: brandId,
        metadata: { channelId },
      })

      return { ok: true }
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
      category_label: trimNullable(candidate.categoryLabel),
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
