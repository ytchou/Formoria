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

  return (
    <div className="grid grid-cols-2 gap-4">
      <Card className="bg-white border-[#E5E4E1]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-[#7C7570]">
            {t('pageViews')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-[#1A1918]">
              {totalViews}
            </span>
            <TrendIcon trend={viewTrend} label={getTrendLabel(viewTrend)} />
          </div>
          <p className="mt-1 text-xs text-[#857E79]">{t('last30Days')}</p>
        </CardContent>
      </Card>

      <Card className="bg-white border-[#E5E4E1]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-[#7C7570]">
            {t('outboundClicks')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-[#1A1918]">
              {totalClicks}
            </span>
            <TrendIcon trend={clickTrend} label={getTrendLabel(clickTrend)} />
          </div>
          <p className="mt-1 text-xs text-[#857E79]">{t('last30Days')}</p>
        </CardContent>
      </Card>
    </div>
  )
}
