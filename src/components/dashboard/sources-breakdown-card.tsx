'use client'

import { ChartNoAxesColumn } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { SurfaceCard } from '@/components/ui/card'
import type { SourceBucket } from '@/lib/analytics/source-bucket'

type SourcesBreakdownCardProps = {
  sources: Array<{
    source: SourceBucket | 'unknown'
    views: number
  }>
}

export function SourcesBreakdownCard({
  sources,
}: SourcesBreakdownCardProps) {
  const t = useTranslations('dashboard.sources')
  const total = sources.reduce((sum, { views }) => sum + views, 0)
  const isEmpty = total === 0

  return (
    <SurfaceCard padding="none" className="overflow-hidden">
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <h3 className="type-card-title-small">
              {t('title')}
            </h3>
            <p className="type-caption">{t('last30Days')}</p>
          </div>
          <p className="type-metadata">
            {t('views', { n: total })}
          </p>
        </div>
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <ChartNoAxesColumn
            className="h-8 w-8 text-muted-foreground"
            aria-hidden="true"
          />
          <h4 className="type-empty-title">
            {t('noDataTitle')}
          </h4>
          <p className="max-w-[320px] type-empty-body">
            {t('noDataBody')}
          </p>
        </div>
      ) : (
        <>
          <div className="h-px w-full bg-border" />
          <div className="pt-2">
            {sources.map(({ source, views }, index) => {
              const pct = Math.round((views / total) * 100)

              return (
                <div
                  key={`${source}-${index}`}
                  className="flex w-full items-center gap-3 px-5 py-2.5"
                >
                  <div className="w-[140px] truncate type-body-emphasis">
                    {t(`labels.${source}`)}
                  </div>
                  <div className="relative h-2 flex-1 rounded-full bg-muted">
                    <div
                      className="absolute top-0 left-0 h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        background: index < 2 ? 'var(--primary)' : 'var(--primary-light)',
                      }}
                    />
                  </div>
                  <div className="type-body-emphasis tabular-nums">
                    {pct}%
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      <div className="h-2" />
    </SurfaceCard>
  )
}
