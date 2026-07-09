'use client'

import type { CSSProperties } from 'react'
import { MousePointerClick } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { SurfaceCard } from '@/components/ui/card'
import type { LinkBreakdownPoint } from '@/lib/services/brand-analytics'
import { cn } from '@/lib/utils'

type LinkBreakdownProps = {
  rows: LinkBreakdownPoint[]
}

const chartStyles = {
  '--chart-1': 'var(--primary)',
  '--chart-2': 'var(--primary-light)',
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
      <p className="type-eyebrow-muted">
        {t('breakdownLabel')}
      </p>

      <SurfaceCard tone="white" padding="lg">
        <div className="flex flex-row items-start justify-between gap-4 pb-4">
          <h3 className="type-card-title">
            {t('perDestination')}
          </h3>
          <p className="type-metadata">
            {t('total', { count: totalClicks })}
          </p>
        </div>

        <div>
          {showEmptyState ? (
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <MousePointerClick
                className="mb-4 h-8 w-8"
                color="var(--muted-foreground)"
                aria-hidden="true"
              />
              <p className="type-empty-title">
                {t('empty')}
              </p>
              <p className="mt-2 max-w-sm type-card-description">
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
                    <span className="w-[120px] shrink-0 truncate type-body-emphasis">
                      {row.destination}
                    </span>
                    <div className="h-2 flex-1 rounded-full bg-secondary">
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
                        'w-10 shrink-0 text-right type-body-emphasis',
                        row.clicks === 0 ? 'text-muted-foreground' : 'text-foreground',
                      )}
                    >
                      {row.clicks}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </SurfaceCard>
    </section>
  )
}
