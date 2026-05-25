'use client'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
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
        className="h-4 w-4 text-[#2D5A27]"
        aria-label={label}
      />
    )
  }
  if (trend === 'down') {
    return (
      <TrendingDown
        className="h-4 w-4 text-[#D94F3D]"
        aria-label={label}
      />
    )
  }
  return (
    <Minus
      className="h-4 w-4 text-[#7C7570]"
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
  return (
    <div className="grid grid-cols-2 gap-4">
      <Card className="bg-white border-[#E5E4E1]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-[#7C7570]">
            Page Views
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-[#1A1918]">
              {totalViews}
            </span>
            <TrendIcon
              trend={viewTrend}
              label={
                viewTrend === 'flat'
                  ? 'Trending flat'
                  : `Views trending ${viewTrend}`
              }
            />
          </div>
          <p className="mt-1 text-xs text-[#857E79]">Last 30 days</p>
        </CardContent>
      </Card>

      <Card className="bg-white border-[#E5E4E1]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-[#7C7570]">
            Outbound Clicks
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-[#1A1918]">
              {totalClicks}
            </span>
            <TrendIcon
              trend={clickTrend}
              label={
                clickTrend === 'flat'
                  ? 'Trending flat'
                  : `Clicks trending ${clickTrend}`
              }
            />
          </div>
          <p className="mt-1 text-xs text-[#857E79]">Last 30 days</p>
        </CardContent>
      </Card>
    </div>
  )
}
