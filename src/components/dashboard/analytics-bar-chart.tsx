'use client'

import { Bar, BarChart, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

export function AnalyticsBarChart({
  data,
}: {
  data: { label: string; value: number }[]
}) {
  if (data.length === 0) return null

  const chartConfig = {
    value: {
      label: 'Sessions',
      color: 'var(--chart-1)',
    },
  } satisfies ChartConfig

  return (
    <div>
      <ChartContainer
        aria-hidden="true"
        className="h-[220px] w-full aspect-auto"
        config={chartConfig}
      >
        <BarChart data={data} margin={{ left: 0, right: 12, top: 12 }}>
          <XAxis dataKey="label" axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} axisLine={false} tickLine={false} width={36} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartContainer>
      <ul className="mt-2 space-y-1">
        {data.map((item) => (
          <li className="flex items-center justify-between text-sm" key={item.label}>
            <span className="text-foreground">{item.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {item.value.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
