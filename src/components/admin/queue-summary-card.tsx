import type { ReactNode } from 'react'
import Link from 'next/link'

import { SurfaceCard } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type QueueSummaryCardProps = {
  title: string
  count: number
  href: string
  emptyMessage: string
  children?: ReactNode
}

export function QueueSummaryCard({
  title,
  count,
  href,
  emptyMessage,
  children,
}: QueueSummaryCardProps) {
  return (
    <SurfaceCard padding="lg" className="overflow-hidden">
      <div className="flex flex-row items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate type-card-title">{title}</h3>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 type-subsection-title text-muted-foreground">
          {count}
        </span>
      </div>
      <div className="mt-6 space-y-4">
        {count === 0 ? (
          <p className="py-4 text-center type-card-description">{emptyMessage}</p>
        ) : (
          <div className="space-y-2">{children}</div>
        )}
        <Link
          href={href}
          className={cn(
            'inline-flex type-body-emphasis text-primary underline-offset-4 hover:underline',
            count === 0 && 'mt-0'
          )}
        >
          查看全部 →
        </Link>
      </div>
    </SurfaceCard>
  )
}
