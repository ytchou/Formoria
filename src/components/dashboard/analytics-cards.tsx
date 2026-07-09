'use client'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { DataCard } from '@/components/ui/card'

type Trend = 'up' | 'down' | 'flat'

type AnalyticsCardsProps = {
  totalViews: number
  totalClicks: number
  viewTrend: Trend
  clickTrend: Trend
}

function benchmarkLabel(totalClicks: number, totalViews: number) {
  const ctr = totalViews > 0 ? totalClicks / totalViews : 0
  return ctr >= 0.03 ? 'good' : 'roomToGrow'
}

function viewBenchmarkLabel(trend: Trend) {
  if (trend === 'up') {
    return 'trendingUp'
  }
  if (trend === 'down') {
    return 'needsAttention'
  }
  return 'stable'
}

function TrendIcon({ trend, label }: { trend: Trend; label: string }) {
  if (trend === 'up') {
    return (
      <TrendingUp
        className="h-4 w-4 text-verified-green"
        aria-label={label}
      />
    )
  }
  if (trend === 'down') {
    return (
      <TrendingDown
        className="h-4 w-4 text-destructive"
        aria-label={label}
      />
    )
  }
  return (
    <Minus
      className="h-4 w-4 text-muted-foreground"
      aria-label={label}
    />
  )
}

export function AnalyticsCards({
  totalViews,
  totalClicks,
  viewTrend,
  clickTrend,
}: AnalyticsCardsProps) {
  const t = useTranslations('dashboard.analytics')
  const getTrendLabel = (trend: Trend) => {
    if (trend === 'up') {
      return t('trendUp')
    }
    if (trend === 'down') {
      return t('trendDown')
    }
    return t('trendFlat')
  }
  const ctrBenchmark = benchmarkLabel(totalClicks, totalViews)
  const viewsBenchmark = viewBenchmarkLabel(viewTrend)

  return (
    <div className="grid grid-cols-2 gap-4">
      <DataCard
        tone="white"
        label={t('pageViews')}
        value={
          <span className="flex items-center gap-2">
            <span>{totalViews}</span>
            <TrendIcon trend={viewTrend} label={getTrendLabel(viewTrend)} />
          </span>
        }
        description={
          <>
            <span>{t(`benchmark.views.${viewsBenchmark}`)}</span>
            <span className="mt-1 block">{t('last30Days')}</span>
          </>
        }
      />

      <DataCard
        tone="white"
        label={t('outboundClicks')}
        value={
          <span className="flex items-center gap-2">
            <span>{totalClicks}</span>
            <TrendIcon trend={clickTrend} label={getTrendLabel(clickTrend)} />
          </span>
        }
        description={
          <>
            <span>{t(`benchmark.ctr.${ctrBenchmark}`)}</span>
            <span className="mt-1 block">{t('last30Days')}</span>
          </>
        }
      />
    </div>
  )
}
