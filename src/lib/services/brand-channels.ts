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
import { createServiceClient } from '@/lib/supabase/service'
import { CITY_NAMES_ZH } from '@/lib/constants/taiwan-cities'
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
  last_confirmed_at?: string | null
  provider_metadata?: Record<string, unknown> | null
}

export const CHANNEL_READ_SELECT =
  'id, name, channel_type, category_label, region_label, address, url, source_url, fetched_at, location_type, country, owner_status, source, removed_at, brand_channel_confirmations(count)'

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
