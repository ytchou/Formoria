'use client'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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
      <Card className="bg-white border-[#E5E0D8]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t('pageViews')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-foreground">
              {totalViews}
            </span>
            <TrendIcon trend={viewTrend} label={getTrendLabel(viewTrend)} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {t(`benchmark.views.${viewsBenchmark}`)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t('last30Days')}</p>
        </CardContent>
      </Card>

      <Card className="bg-white border-[#E5E0D8]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t('outboundClicks')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-foreground">
              {totalClicks}
            </span>
            <TrendIcon trend={clickTrend} label={getTrendLabel(clickTrend)} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {t(`benchmark.ctr.${ctrBenchmark}`)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t('last30Days')}</p>
        </CardContent>
      </Card>
    </div>
  )
}
