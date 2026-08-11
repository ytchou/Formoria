import type { BrandChannel } from '@/lib/types/brand-channel'

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
  ownerStatus: string
  source: string
  confirmationCount: number
  removedAt: string | null
}

export type ChannelKind = 'official' | 'visitable' | 'chain' | 'online'

export type ChannelKindGroups = Array<{
  key: ChannelKind
  channels: BrandChannel[]
}>

const CHANNEL_KIND_ORDER: ChannelKind[] = [
  'official',
  'visitable',
  'chain',
  'online',
]

function sortChannelsForDisplay(a: BrandChannel, b: BrandChannel): number {
  const statusOrder =
    Number(a.status !== 'confirmed') - Number(b.status !== 'confirmed')
  if (statusOrder !== 0) return statusOrder

  const confirmationOrder = b.confirmationCount - a.confirmationCount
  if (confirmationOrder !== 0) return confirmationOrder

  return a.name.localeCompare(b.name)
}

export function groupChannelsByKind(
  channels: BrandChannel[],
): ChannelKindGroups {
  const grouped: Record<ChannelKind, BrandChannel[]> = {
    official: [],
    visitable: [],
    chain: [],
    online: [],
  }

  for (const channel of channels) {
    const key: ChannelKind =
      channel.ownerStatus === 'confirmed' && channel.source === 'owner'
        ? 'official'
        : channel.address != null
          ? 'visitable'
          : channel.channelType === 'offline'
            ? 'chain'
            : 'online'

    grouped[key].push(channel)
  }

  return CHANNEL_KIND_ORDER.flatMap((key) => {
    const group = grouped[key]
    if (group.length === 0) return []
    return [{ key, channels: [...group].sort(sortChannelsForDisplay) }]
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
    const status: BrandChannel['status'] =
      ownerConfirmed || communityConfirmed ? 'confirmed' : 'unconfirmed'
    const channel: BrandChannel = {
      id: row.id,
      name: row.name,
      channelType: row.channelType as BrandChannel['channelType'],
      categoryLabel: row.categoryLabel,
      regionLabel: row.regionLabel,
      address: row.address,
      url: row.url,
      ownerStatus: row.ownerStatus as BrandChannel['ownerStatus'],
      source: row.source as BrandChannel['source'],
      confirmationCount: row.confirmationCount,
      status,
      ...(status === 'confirmed'
        ? {
            confirmedBy: ownerConfirmed ? ('owner' as const) : ('community' as const),
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
