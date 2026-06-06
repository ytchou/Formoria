'use client'

import type { CSSProperties } from 'react'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ChartConfig } from '@/components/ui/chart'
import type { DailyPoint } from '@/lib/services/brand-analytics'
import { cn } from '@/lib/utils'

type AnalyticsChartProps = {
  series: DailyPoint[]
}

type AnalyticsChartCanvasProps = {
  config: ChartConfig
  data: DailyPoint[]
}

type Period = '30d' | '90d'

const chartStyles = {
  '--chart-1': '#2F5D50',
  '--chart-2': '#6F9B8C',
} as CSSProperties

const chartHeightClassName = 'h-[180px] w-full'

function formatAxisDate(value: string) {
  return value.slice(5).replace('-', '/')
}

const AnalyticsChartCanvas = dynamic<AnalyticsChartCanvasProps>(
  () =>
    Promise.all([import('recharts'), import('@/components/ui/chart')]).then(
      ([recharts, chartModule]) => {
        const { Area, AreaChart, CartesianGrid, XAxis, YAxis } = recharts
        const { ChartContainer, ChartTooltip, ChartTooltipContent } = chartModule

        function AnalyticsChartCanvasInner({
          config,
          data,
        }: AnalyticsChartCanvasProps) {
          return (
            <ChartContainer
              config={config}
              className={cn(chartHeightClassName, 'aspect-auto')}
            >
              <AreaChart
                data={data}
                margin={{ top: 8, right: 12, left: -16, bottom: 0 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="#E5E0D8"
                />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tickMargin={10}
                  minTickGap={24}
                  tick={{ fill: '#9E9893', fontSize: 11 }}
                  tickFormatter={formatAxisDate}
                />
                <YAxis hide />
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent />}
                />
                <Area
                  dataKey="views"
                  type="monotone"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  fill="var(--chart-1)"
                  fillOpacity={0.12}
                />
                <Area
                  dataKey="clicks"
                  type="monotone"
                  stroke="var(--chart-2)"
                  strokeWidth={1.5}
                  fill="var(--chart-2)"
                  fillOpacity={0.1}
                />
              </AreaChart>
            </ChartContainer>
          )
        }

        return AnalyticsChartCanvasInner
      }
    ),
  {
    ssr: false,
    loading: () => (
      <div
        aria-hidden="true"
        className={chartHeightClassName}
      />
    ),
  }
)

export function AnalyticsChart({ series }: AnalyticsChartProps) {
  const t = useTranslations('dashboard.analytics')
  const [period, setPeriod] = useState<Period>('30d')
  const data = period === '30d' ? series.slice(-30) : series

  const chartConfig: ChartConfig = {
    views: {
      label: t('views'),
      color: '#2F5D50',
    },
    clicks: {
      label: t('clicks'),
      color: '#6F9B8C',
    },
  }

  return (
    <section
      className="space-y-3"
      style={chartStyles}
    >
      <p className="text-[11px] font-medium tracking-widest text-[#7C7570]">
        {t('trendsLabel')}
      </p>

      <Card className="rounded-xl border-[#E5E0D8] bg-white shadow-none">
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-5">
          <div className="space-y-1">
            <CardTitle className="font-heading text-[15px] font-bold text-[#1C1C1C]">
              {t('viewsClicksTitle')}
            </CardTitle>
            <p className="text-sm text-[#6B6B6B]">{t('dailyTrend')}</p>
          </div>

          <div
            role="group"
            aria-label="period"
            className="inline-flex items-center gap-1 rounded-[8px] border border-[#E5E0D8] bg-white p-1"
          >
            {(['30d', '90d'] as const).map((value) => {
              const isActive = period === value

              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setPeriod(value)}
                  className={cn(
                    'rounded-[7px] px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-[#1C1C1C] text-white'
                      : 'bg-white text-[#6B6B6B]'
                  )}
                >
                  {value === '30d' ? t('period30') : t('period90')}
                </button>
              )
            })}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-center gap-5 text-sm text-[#1C1C1C]">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: 'var(--chart-1)' }}
              />
              <span>{t('views')}</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: 'var(--chart-2)' }}
              />
              <span>{t('clicks')}</span>
            </div>
          </div>

          <AnalyticsChartCanvas
            config={chartConfig}
            data={data}
          />
        </CardContent>
      </Card>
    </section>
  )
}
