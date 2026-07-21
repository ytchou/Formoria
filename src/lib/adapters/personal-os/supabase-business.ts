import type {
  FormoriaBusinessData,
  FormoriaBusinessDataSource,
} from '@/lib/services/formoria-business'
import type { DateWindow } from '@/lib/analytics/posthog-types'
import { createServiceClient } from '@/lib/supabase/server'

type ApprovedBrandRow = {
  id: string
  approved_at: string | null
}

type SubscriberRow = {
  confirmed_at: string | null
  unsubscribed_at: string | null
}

function assertResult<T>(result: {
  data: T | null
  error: { message?: string } | null
}): T {
  if (result.error) throw new Error(result.error.message ?? 'Business data query failed')
  return result.data as T
}

function inWindow(value: string | null, window: DateWindow): boolean {
  if (!value) return false
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) return false
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(timestamp)
  return date >= window.startDate && date <= window.endDate
}

function netConfirmations(rows: SubscriberRow[], window: DateWindow): number {
  const confirmations = rows.filter((row) => inWindow(row.confirmed_at, window)).length
  const unsubscribes = rows.filter((row) => inWindow(row.unsubscribed_at, window)).length
  return confirmations - unsubscribes
}

export function summarizeBusinessGrowth(
  input: {
    brands: ApprovedBrandRow[]
    owners: Array<{ brand_id: string }>
    subscribers: SubscriberRow[]
  },
  windows: { current: DateWindow; prior: DateWindow },
): FormoriaBusinessData {
  const approvedBrandIds = new Set(input.brands.map((brand) => brand.id))
  const claimedBrandIds = new Set(
    input.owners
      .filter((owner) => approvedBrandIds.has(owner.brand_id))
      .map((owner) => owner.brand_id),
  )

  return {
    supply: {
      approvedBrands: input.brands.length,
      newApproved: {
        current: input.brands.filter((brand) => inWindow(brand.approved_at, windows.current)).length,
        prior: input.brands.filter((brand) => inWindow(brand.approved_at, windows.prior)).length,
      },
      claimedShare: input.brands.length > 0 ? claimedBrandIds.size / input.brands.length : 0,
    },
    audience: {
      confirmedSubscribers: input.subscribers.filter(
        (subscriber) => subscriber.confirmed_at && !subscriber.unsubscribed_at,
      ).length,
      netConfirmations: {
        current: netConfirmations(input.subscribers, windows.current),
        prior: netConfirmations(input.subscribers, windows.prior),
      },
    },
  }
}

async function loadBusinessGrowth(
  windows: { current: DateWindow; prior: DateWindow },
): Promise<FormoriaBusinessData> {
  const client = createServiceClient()
  const [brandsResult, ownersResult, subscribersResult] = await Promise.all([
    client.from('brands').select('id, approved_at').eq('status', 'approved'),
    client.from('brand_owners').select('brand_id'),
    client.from('newsletter_subscribers').select('confirmed_at, unsubscribed_at'),
  ])

  return summarizeBusinessGrowth(
    {
      brands: assertResult(brandsResult) as ApprovedBrandRow[],
      owners: assertResult(ownersResult) as Array<{ brand_id: string }>,
      subscribers: assertResult(subscribersResult) as SubscriberRow[],
    },
    windows,
  )
}

export function createSupabaseBusinessDataSource(): FormoriaBusinessDataSource {
  return { load: loadBusinessGrowth }
}
