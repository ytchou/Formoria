'use client'

import type { ReactNode } from 'react'
import { ListChecks } from 'lucide-react'
import { surfaceCardStyles } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type ProgressStepCardProps = {
  title: ReactNode
  progressText: ReactNode
  progressLabel: string
  value: number
  max: number
  children: ReactNode
  className?: string
  childrenClassName?: string
}

export function ProgressStepCard({
  title,
  progressText,
  progressLabel,
  value,
  max,
  children,
  className,
  childrenClassName,
}: ProgressStepCardProps) {
  const percentage =
    max > 0 ? Math.min(Math.max((value / max) * 100, 0), 100) : 0

  return (
    <section
      className={cn(
        surfaceCardStyles(),
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <ListChecks className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="type-label">
            {title}
          </h2>
          <p className="mt-0.5 type-body-sm">{progressText}</p>
        </div>
      </div>

      <div
        className="mt-4 h-2 overflow-hidden rounded-full bg-surface"
        role="progressbar"
        aria-label={progressLabel}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${percentage}%` }}
        />
      </div>

      <div className={cn('mt-5', childrenClassName)}>{children}</div>
    </section>
  )
}
