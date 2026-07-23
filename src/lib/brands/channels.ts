import type { BrandChannel } from '@/lib/types/brand-channel'

export const CHANNEL_CONFIRMATION_THRESHOLD = Number(
  process.env.CHANNEL_CONFIRMATION_THRESHOLD ?? 3,
)

export const RETAILER_NAME_NOISE: readonly string[] = [
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
  const normalized = name.toLocaleLowerCase().replace(/\s+/g, '')

  for (const noise of RETAILER_NAME_NOISE) {
    if (normalized.endsWith(noise)) {
      const withoutNoise = normalized.slice(0, -noise.length)
      return withoutNoise || normalized
    }
  }

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
