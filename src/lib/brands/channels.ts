import type { BrandChannel } from '@/lib/types/brand-channel'
import { CITY_NAMES_ZH } from '@/lib/constants/taiwan-cities'

const REGION_SLUG_BY_LABEL: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(CITY_NAMES_ZH).map(([slug, label]) => [label, slug]),
  )

export const CHANNEL_CONFIRMATION_THRESHOLD = Number(
  process.env.CHANNEL_CONFIRMATION_THRESHOLD ?? 3,
)

/**
 * Region-label sentinel the enrichment phase writes for multi-branch retailers.
 * Data value, not UI copy — the UI matches on it to suppress a location label.
 */
export const CHAIN_REGION_LABEL = '全台多間門市'

const RETAILER_NAME_NOISE: readonly string[] = [
  '戶外休閒專業中心',
  '戶外用品專門店',
  '戶外用品店',
  '戶外休閒',
  '戶外用品',
  '戶外',
  '專業中心',
  '旗艦門市',
  '旗艦店',
  '專賣店',
  '用品店',
  '分公司',
  '門市',
  '分店',
  '選物',
  '商店',
  '店',
]

export function normalizeChannelName(name: string): string {
  let normalized = name.toLocaleLowerCase().replace(/\s+/g, '')

  let stripped: boolean
  do {
    stripped = false
    for (const noise of RETAILER_NAME_NOISE) {
      if (normalized.endsWith(noise)) {
        const withoutNoise = normalized.slice(0, -noise.length)
        if (withoutNoise) {
          normalized = withoutNoise
          stripped = true
          break
        }
      }
    }
  } while (stripped)

  return normalized
}

type ChannelRow = {
  id: string
  name: string
  channelType: string
  categoryLabel: string | null
  regionLabel: string | null
  address: string | null
  url: string | null
  sourceUrl?: string | null
  fetchedAt?: string | null
  locationType?: string | null
  country?: string | null
  ownerStatus: string
  source: string
  confirmationCount: number
  removedAt: string | null
}

export type ChannelRegionGroup = {
  key: string
  channels: BrandChannel[]
}

function sortChannelsForDisplay(a: BrandChannel, b: BrandChannel): number {
  const statusOrder =
    Number(a.status !== 'confirmed') - Number(b.status !== 'confirmed')
  if (statusOrder !== 0) return statusOrder

  const confirmationOrder = b.confirmationCount - a.confirmationCount
  if (confirmationOrder !== 0) return confirmationOrder

  return a.name.localeCompare(b.name)
}

export function regionLabelToSlug(regionLabel: string): string | null {
  return REGION_SLUG_BY_LABEL[regionLabel] ?? null
}

export function groupChannelsByRegion(
  channels: BrandChannel[],
): ChannelRegionGroup[] {
  const grouped = new Map<string, BrandChannel[]>()

  for (const channel of channels) {
    const regionSlug = channel.regionLabel
      ? regionLabelToSlug(channel.regionLabel)
      : null
    const key =
      channel.channelType === 'online'
        ? 'online'
        : channel.country != null && channel.country !== 'TW'
          ? 'overseas'
          : channel.regionLabel === CHAIN_REGION_LABEL
            ? 'all_taiwan'
            : (regionSlug ?? 'overseas')
    const group = grouped.get(key) ?? []
    group.push(channel)
    grouped.set(key, group)
  }

  return [...grouped.entries()]
    .map(([key, group]) => ({
      key,
      channels: [...group].sort(sortChannelsForDisplay),
    }))
    .sort((left, right) => {
      if (left.key === 'online') return 1
      if (right.key === 'online') return -1
      return (
        right.channels.length - left.channels.length ||
        left.key.localeCompare(right.key)
      )
    })
}

export function groupChannelsForDisplay(
  rows: Array<ChannelRow>,
  viewerConfirmedIds?: string[],
): { confirmed: BrandChannel[]; possible: BrandChannel[] } {
  const viewerConfirmedIdSet = new Set(viewerConfirmedIds)
  const confirmed: BrandChannel[] = []
  const possible: BrandChannel[] = []

  for (const row of rows) {
    if (row.removedAt !== null || row.ownerStatus === 'rejected') continue

    const ownerConfirmed = row.ownerStatus === 'confirmed'
    const communityConfirmed =
      row.confirmationCount >= CHANNEL_CONFIRMATION_THRESHOLD
    const evidenceBacked = row.sourceUrl != null && row.source !== 'community'
    const status: BrandChannel['status'] =
      ownerConfirmed || communityConfirmed || evidenceBacked
        ? 'confirmed'
        : 'unconfirmed'
    const channel: BrandChannel = {
      id: row.id,
      name: row.name,
      channelType: row.channelType as BrandChannel['channelType'],
      categoryLabel: row.categoryLabel,
      regionLabel: row.regionLabel,
      address: row.address,
      url: row.url,
      sourceUrl: row.sourceUrl ?? null,
      fetchedAt: row.fetchedAt ?? null,
      locationType: (row.locationType as BrandChannel['locationType']) ?? null,
      country: row.country ?? null,
      ownerStatus: row.ownerStatus as BrandChannel['ownerStatus'],
      source: row.source as BrandChannel['source'],
      confirmationCount: row.confirmationCount,
      status,
      ...(status === 'confirmed'
        ? {
            confirmedBy: ownerConfirmed
              ? ('owner' as const)
              : communityConfirmed
                ? ('community' as const)
                : ('evidence' as const),
          }
        : {}),
      ...(viewerConfirmedIds
        ? { hasCurrentUserConfirmed: viewerConfirmedIdSet.has(row.id) }
        : {}),
    }

    if (status === 'confirmed') {
      confirmed.push(channel)
    } else {
      possible.push(channel)
    }
  }

  return { confirmed, possible }
}
