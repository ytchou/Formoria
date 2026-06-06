'use client'

import { ChartNoAxesColumn } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { SourceBucket } from '@/lib/analytics/source-bucket'

type SourcesBreakdownCardProps = {
  sources: Array<{
    source: SourceBucket | 'unknown'
    views: number
  }>
}

const LABELS: Record<SourceBucket | 'unknown', string> = {
  direct: 'Direct',
  search: 'Internal search',
  category: 'Category',
  directory: 'Directory',
  recommendation: 'Recommendation',
  external_search: 'External search',
  social: 'Social',
  external: 'External',
  unknown: 'Other',
}

export function SourcesBreakdownCard({
  sources,
}: SourcesBreakdownCardProps) {
  const total = sources.reduce((sum, { views }) => sum + views, 0)
  const isEmpty = total === 0

  return (
    <Card className="overflow-hidden rounded-xl border border-[#E5E0D8] bg-white shadow-none">
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <h3 className="font-heading text-[15px] font-bold text-[#1C1C1C]">
              Traffic Sources
            </h3>
            <p className="text-[12px] text-[#7C7570]">Last 30 days</p>
          </div>
          <p
            className={`text-[13px] font-medium ${
              isEmpty ? 'text-[#9E9893]' : 'text-[#6B6B6B]'
            }`}
          >
            {total} views
          </p>
        </div>
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <ChartNoAxesColumn
            className="h-8 w-8 text-[#C8C3BC]"
            aria-hidden="true"
          />
          <h4 className="font-heading text-[15px] font-semibold text-[#9E9893]">
            No traffic data yet
          </h4>
          <p className="max-w-[320px] text-[13px] leading-relaxed text-[#B0AAA4]">
            When visitors reach your brand page, you&apos;ll see a breakdown by
            traffic source here.
          </p>
          <p className="max-w-[320px] text-[12px] leading-[1.7] text-[#C8C3BC]">
            訪客進入品牌頁面後，此處將顯示各流量來源的數據。
          </p>
        </div>
      ) : (
        <>
          <div className="h-px w-full bg-[#E5E0D8]" />
          <div className="pt-2">
            {sources.map(({ source, views }, index) => {
              const pct = Math.round((views / total) * 100)

              return (
                <div
                  key={`${source}-${index}`}
                  className="flex w-full items-center gap-3 px-5 py-2.5"
                >
                  <div className="w-[140px] truncate text-[13px] font-medium text-[#1C1C1C]">
                    {LABELS[source]}
                  </div>
                  <div className="relative h-2 flex-1 rounded-full bg-[#F0ECE4]">
                    <div
                      className="absolute top-0 left-0 h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        background: index < 2 ? '#2F5D50' : '#6F9B8C',
                      }}
                    />
                  </div>
                  <div className="text-[13px] font-semibold tabular-nums text-[#1C1C1C]">
                    {pct}%
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      <div className="h-2" />
    </Card>
  )
}
