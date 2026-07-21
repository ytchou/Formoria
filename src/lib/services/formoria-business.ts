import { createSupabaseBusinessDataSource } from '@/lib/adapters/personal-os/supabase-business'
import type { Comparison, DateWindow } from '@/lib/analytics/posthog-types'
import { getAnalyticsDateWindows } from './posthog-analytics'

export type FormoriaBusinessData = {
  supply: {
    approvedBrands: number
    newApproved: Comparison
    claimedShare: number
  }
  audience: {
    confirmedSubscribers: number
    netConfirmations: Comparison
  }
}

export interface FormoriaBusinessDataSource {
  load(windows: { current: DateWindow; prior: DateWindow }): Promise<FormoriaBusinessData>
}

function taipeiDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export async function getFormoriaBusinessSnapshot({
  dataSource = createSupabaseBusinessDataSource(),
  now = () => new Date(),
}: {
  dataSource?: FormoriaBusinessDataSource
  now?: () => Date
} = {}) {
  const generatedAt = now()
  const { current, prior } = getAnalyticsDateWindows(taipeiDate(generatedAt))
  const business = await dataSource.load({ current, prior })

  return {
    schemaVersion: 1 as const,
    generatedAt: generatedAt.toISOString(),
    dataThrough: current.endDate,
    timeZone: 'Asia/Taipei' as const,
    windows: { current, prior },
    ...business,
  }
}
