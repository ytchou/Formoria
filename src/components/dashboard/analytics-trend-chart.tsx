'use client'

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

type AnalyticsTrendChartProps = {
  data: {
    date: string
    profileSessions: number
    outboundSessions: number
  }[]
  labels: {
    profile: string
    outbound: string
    aria: string
  }
}

export function AnalyticsTrendChart({ data, labels }: AnalyticsTrendChartProps) {
  const chartConfig = {
    profileSessions: {
      label: labels.profile,
      color: 'var(--foreground)',
    },
    outboundSessions: {
      label: labels.outbound,
      color: 'var(--muted-foreground)',
    },
  } satisfies ChartConfig

  return (
    <div role="img" aria-label={labels.aria}>
      <ChartContainer className="h-[300px] w-full aspect-auto" config={chartConfig}>
        <LineChart data={data} margin={{ left: 0, right: 12, top: 12 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="date"
            minTickGap={24}
            tickLine={false}
          />
          <YAxis allowDecimals={false} axisLine={false} tickLine={false} width={36} />
          <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
          <Line
            dataKey="profileSessions"
            dot={false}
            stroke="var(--color-profileSessions)"
            strokeWidth={2}
            type="monotone"
          />
          <Line
            dataKey="outboundSessions"
            dot={false}
            stroke="var(--color-outboundSessions)"
            strokeDasharray="6 4"
            strokeWidth={2}
            type="monotone"
          />
        </LineChart>
      </ChartContainer>
      <div className="mt-3 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="h-0.5 w-5 bg-foreground" aria-hidden="true" />
          <span>{labels.profile}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-5 border-t-2 border-dashed border-muted-foreground" aria-hidden="true" />
          <span>{labels.outbound}</span>
        </div>
      </div>
    </div>
  )
}
