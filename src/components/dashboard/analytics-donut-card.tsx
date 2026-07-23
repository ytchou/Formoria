'use client'

import { Cell, Pie, PieChart } from 'recharts'
import { SurfaceCard } from '@/components/ui/card'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'

type AnalyticsDonutCardProps = {
  title: string
  rows: {
    key: string
    label: string
    sessions: number
  }[]
  emptyLabel: string
  centerLabel?: string
}

const PALETTE = [
  'var(--foreground)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--primary)',
  'var(--muted-foreground)',
] as const

function paletteColor(index: number): string {
  return PALETTE[Math.min(index, PALETTE.length - 1)] ?? 'var(--muted-foreground)'
}

export function AnalyticsDonutCard({
  title,
  rows,
  emptyLabel,
  centerLabel,
}: AnalyticsDonutCardProps) {
  const total = rows.reduce((sum, row) => sum + row.sessions, 0)
  const chartConfig: ChartConfig = Object.fromEntries(rows.map((row, index) => [
    `segment${index + 1}`,
    { label: row.label, color: paletteColor(index) },
  ]))

  return (
    <SurfaceCard className="rounded-md" padding="lg">
      <h2 className="type-card-title">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <>
          <div className="relative mx-auto mt-4 w-full max-w-[280px]">
            <ChartContainer
              aria-hidden="true"
              className="h-[220px] w-full aspect-auto"
              config={chartConfig}
            >
              <PieChart>
                <Pie
                  data={rows}
                  dataKey="sessions"
                  innerRadius={58}
                  nameKey="label"
                  outerRadius={88}
                  strokeWidth={0}
                >
                  {rows.map((row, index) => (
                    <Cell
                      fill={`var(--color-segment${index + 1})`}
                      key={row.key}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            {centerLabel ? (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center type-stat">
                {centerLabel}
              </span>
            ) : null}
          </div>
          <ul className="mt-5 space-y-3">
            {rows.map((row, index) => (
              <li className="flex items-center gap-3 text-sm" key={row.key}>
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: paletteColor(index) }}
                />
                <span className="min-w-0 flex-1 text-foreground">{row.label}</span>
                <span className="text-muted-foreground tabular-nums">
                  {total === 0 ? '0%' : `${Math.round((row.sessions / total) * 100)}%`}
                </span>
                <span className="w-12 text-right font-medium text-foreground tabular-nums">
                  {row.sessions.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </SurfaceCard>
  )
}
