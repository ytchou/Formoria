export type DateWindow = { startDate: string; endDate: string }
export type Comparison = { current: number; prior: number | null }
export type RateComparison = { current: number | null; prior: number | null }

export type DailyPoint = {
  date: string
  uniqueVisitors: number
  publicSessions: number
  pageviews: number
  brandProfileSessions: number
  outboundSessions: number
}

export type AcquisitionRow = {
  source: string
  medium: string
  sessions: number
}

export type TopBrandRow = {
  brandId: string
  brandName: string
  brandSlug: string
  brandProfileSessions: number
  outboundSessions: number
}

export type TopPageRow = {
  pagePath: string
  pageviews: Comparison
  sessions: Comparison
}

export type AnalyticsSnapshotV1 = {
  schemaVersion: 1
  generatedAt: string
  dataThrough: string
  timeZone: 'Asia/Taipei'
  windows: { current: DateWindow; prior: DateWindow; trend: DateWindow }
  audience: {
    uniqueVisitors: Comparison
    publicSessions: Comparison
    pageviews: Comparison
  }
  discovery: {
    brandProfileSessions: Comparison
    outboundSessions: Comparison
    brandReachRate: RateComparison
    outboundConversion: RateComparison
  }
  daily: DailyPoint[] | null
  acquisition: AcquisitionRow[] | null
  topBrands: TopBrandRow[] | null
  engagement?: {
    bounceRate: RateComparison
    avgDurationSeconds: Comparison
    searchSessions: Comparison
    searchEvents: number
  } | null
  topPages?: TopPageRow[] | null
  completeness: {
    comparisonReady: boolean
    availableFrom: string | null
    warnings: string[]
  }
  sourceUrl: string
}

export type OwnerDailyPoint = {
  date: string
  profileSessions: number
  outboundSessions: number
}

export type DestinationRow = {
  destination: string
  sessions: number
}

export type TrafficSourceRow = {
  source: string
  sessions: number
}

export type OwnerAnalyticsSnapshotV1 = {
  schemaVersion: 1
  generatedAt: string
  dataThrough: string
  timeZone: 'Asia/Taipei'
  windows: { current: DateWindow; prior: DateWindow; trend: DateWindow }
  profileSessions: Comparison | null
  outboundSessions: Comparison | null
  outboundConversion: RateComparison | null
  daily: OwnerDailyPoint[] | null
  trafficSources: TrafficSourceRow[] | null
  topTrafficSource: { source: string; share: number } | null
  destinations: DestinationRow[] | null
  completeness: {
    comparisonReady: boolean
    availableFrom: string | null
    warnings: string[]
  }
}
