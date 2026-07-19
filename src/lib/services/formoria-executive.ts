import { createSupabaseExecutiveDataSource } from '@/lib/adapters/personal-os/supabase-executive'
import { getExecutiveHealth, type ExecutiveHealthSnapshot } from './executive-health'

export interface ExecutiveDateWindow {
  startDate: string
  endDate: string
}

export interface ExecutiveDateWindows {
  current: ExecutiveDateWindow
  prior: ExecutiveDateWindow
}

export interface FormoriaExecutiveBusinessData {
  supply: {
    approvedBrands: number
    newApproved: { current: number; prior: number }
    claimedShare: number
  }
  audience: {
    confirmedSubscribers: number
    netConfirmations: { current: number; prior: number }
  }
  engagement: {
    topBrands: Array<{ id: string; name: string; slug: string; views: number; clicks: number }>
    destinationMix: Array<{ destination: string; clicks: number }>
  }
  curation: {
    activeJobs: number
    latestOutcome: {
      id: string
      status: string
      completedAt: string | null
      failedCount: number
      totalCount: number
    } | null
  }
}

export interface FormoriaExecutiveDataSource {
  load(windows: ExecutiveDateWindows): Promise<FormoriaExecutiveBusinessData>
}

function shiftIsoDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const value = new Date(Date.UTC(year, month - 1, day))
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function getExecutiveDateWindows(today: string): ExecutiveDateWindows {
  return {
    current: { startDate: shiftIsoDate(today, -8), endDate: shiftIsoDate(today, -2) },
    prior: { startDate: shiftIsoDate(today, -15), endDate: shiftIsoDate(today, -9) },
  }
}

function taipeiDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export async function getFormoriaExecutiveSnapshot({
  dataSource = createSupabaseExecutiveDataSource(),
  getHealth = getExecutiveHealth,
  now = () => new Date(),
}: {
  dataSource?: FormoriaExecutiveDataSource
  getHealth?: () => Promise<ExecutiveHealthSnapshot>
  now?: () => Date
} = {}) {
  const generatedAt = now()
  const windows = getExecutiveDateWindows(taipeiDate(generatedAt))
  const [business, systemStatus] = await Promise.all([dataSource.load(windows), getHealth()])

  return {
    schemaVersion: 1 as const,
    generatedAt: generatedAt.toISOString(),
    windows,
    ...business,
    systemStatus,
  }
}
