'use client'

import type { CSSProperties } from 'react'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { SurfaceCard } from '@/components/ui/card'
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
  '--chart-1': 'var(--primary)',
  '--chart-2': 'var(--primary-light)',
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
                  stroke="var(--border)"
                />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tickMargin={10}
                  minTickGap={24}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
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
      color: 'var(--primary)',
    },
    clicks: {
      label: t('clicks'),
      color: 'var(--primary-light)',
    },
  }

  return (
    <section
      className="space-y-3"
      style={chartStyles}
    >
      <p className="type-eyebrow-muted">
        {t('trendsLabel')}
      </p>

      <SurfaceCard padding="lg">
        <div className="flex flex-row items-start justify-between gap-4 pb-5">
          <div className="space-y-1">
            <h3 className="type-card-title-small">
              {t('viewsClicksTitle')}
            </h3>
            <p className="type-card-description">{t('dailyTrend')}</p>
          </div>

          <div
            role="group"
            aria-label="period"
            className="inline-flex items-center gap-1 rounded-[8px] border border-border bg-white p-1"
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
                      ? 'bg-foreground text-white'
                      : 'bg-white text-muted-foreground'
                  )}
                >
                  {value === '30d' ? t('period30') : t('period90')}
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-5 text-sm text-foreground">
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
        </div>
      </SurfaceCard>
    </section>
  )
}
