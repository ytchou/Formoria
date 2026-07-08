'use client'

import { useTransition } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type DashboardQueueItemProps = {
  label: string
  sublabel?: string
  date: string
  riskLevel?: 'high' | 'medium' | 'clean'
  onApprove: () => Promise<unknown>
  isPending?: boolean
}

const riskClassNames = {
  high: 'bg-destructive/10 text-destructive border-destructive/20',
  medium: 'bg-muted text-muted-foreground border-border',
  clean: 'bg-verified-green-bg text-verified-green border-verified-green',
} satisfies Record<NonNullable<DashboardQueueItemProps['riskLevel']>, string>

const riskLabels = {
  high: '高風險',
  medium: '中風險',
  clean: '通過',
} as const

export function DashboardQueueItem({
  label,
  sublabel,
  date,
  riskLevel,
  onApprove,
  isPending = false,
}: DashboardQueueItemProps) {
  const [internalPending, startTransition] = useTransition()
  const isDisabled = isPending || internalPending

  return (
    <div className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{label}</p>
        {sublabel ? (
          <p className="truncate type-card-description">{sublabel}</p>
        ) : null}
      </div>
      <time className="shrink-0 type-card-description">{date}</time>
      {riskLevel ? (
        <Badge className={cn('border text-xs', riskClassNames[riskLevel])}>
          {riskLabels[riskLevel]}
        </Badge>
      ) : null}
      <Button
        size="default"
        onClick={() => {
          startTransition(() => {
            onApprove()
          })
        }}
        disabled={isDisabled}
      >
        核准
      </Button>
    </div>
  )
}
