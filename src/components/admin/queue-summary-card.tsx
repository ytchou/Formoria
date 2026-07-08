import type { ReactNode } from 'react'
import Link from 'next/link'

import { Card, CardContent, CardHeader } from '@/components/ui/card'
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
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate type-card-title">{title}</h3>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-sm font-semibold text-muted-foreground">
          {count}
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        {count === 0 ? (
          <p className="py-4 text-center type-card-description">{emptyMessage}</p>
        ) : (
          <div className="space-y-2">{children}</div>
        )}
        <Link
          href={href}
          className={cn(
            'inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline',
            count === 0 && 'mt-0'
          )}
        >
          查看全部 →
        </Link>
      </CardContent>
    </Card>
  )
}
