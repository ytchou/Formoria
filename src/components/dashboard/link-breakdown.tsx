'use client'

import type { CSSProperties } from 'react'
import { MousePointerClick } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { LinkBreakdownPoint } from '@/lib/services/brand-analytics'
import { cn } from '@/lib/utils'

type LinkBreakdownProps = {
  rows: LinkBreakdownPoint[]
}

const chartStyles = {
  '--chart-1': '#2F5D50',
  '--chart-2': '#6F9B8C',
} as CSSProperties

export function LinkBreakdown({ rows }: LinkBreakdownProps) {
  const t = useTranslations('dashboard.analytics')
  const orderedRows = [...rows].sort((left, right) => right.clicks - left.clicks)
  const totalClicks = orderedRows.reduce((sum, row) => sum + row.clicks, 0)
  const maxClicks = orderedRows.reduce((max, row) => Math.max(max, row.clicks), 0)
  const showEmptyState = orderedRows.length === 0 || orderedRows.every((row) => row.clicks === 0)

  return (
    <section
      className="space-y-3"
      style={chartStyles}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7C7570]">
        {t('breakdownLabel')}
      </p>

      <Card className="rounded-xl border-[#E5E0D8] bg-white shadow-none">
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-4">
          <CardTitle className="text-base font-semibold text-[#1C1C1C]">
            {t('perDestination')}
          </CardTitle>
          <p className="text-sm font-medium text-[#7C7570]">
            {t('total', { count: totalClicks })}
          </p>
        </CardHeader>

        <CardContent>
          {showEmptyState ? (
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <MousePointerClick
                className="mb-4 h-8 w-8"
                color="#C8C3BC"
                aria-hidden="true"
              />
              <p className="text-base font-medium text-[#9E9893]">
                {t('empty')}
              </p>
              <p className="mt-2 max-w-sm text-sm leading-6 text-[#B0AAA4]">
                {t('emptyBody')}
              </p>
            </div>
          ) : (
            <ul className="space-y-4">
              {orderedRows.map((row) => {
                const width = maxClicks > 0
                  ? `${(row.clicks / maxClicks) * 100}%`
                  : '0%'
                const isTopDestination = row.clicks === maxClicks

                return (
                  <li
                    key={row.destination}
                    role="listitem"
                    className="flex items-center gap-4"
                  >
                    <span className="w-[120px] shrink-0 truncate text-[13px] font-medium text-[#1C1C1C]">
                      {row.destination}
                    </span>
                    <div className="h-2 flex-1 rounded-full bg-[#F5F4F1]">
                      <div
                        data-testid="bar"
                        className={cn('h-full rounded-full')}
                        style={{
                          width,
                          backgroundColor: isTopDestination ? 'var(--chart-1)' : 'var(--chart-2)',
                        }}
                      />
                    </div>
                    <span
                      className={cn(
                        'w-10 shrink-0 text-right text-[13px] font-semibold',
                        row.clicks === 0 ? 'text-[#9E9893]' : 'text-[#1C1C1C]',
                      )}
                    >
                      {row.clicks}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
