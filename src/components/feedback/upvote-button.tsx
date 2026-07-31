'use client'

import { ChevronUp } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useFeatureRequestVotes } from '@/hooks/use-feature-request-votes'
import { trackFeatureRequestVoted } from '@/lib/analytics'
import { cn } from '@/lib/utils'

type UpvoteButtonProps = {
  requestId: string
  title: string
  count: number
  className?: string
}

export function UpvoteButton({
  requestId,
  title,
  count: initialCount,
  className,
}: UpvoteButtonProps) {
  const t = useTranslations('feedback.upvote')
  const { votedIds, loading: votesLoading, vote } = useFeatureRequestVotes()
  const [count, setCount] = useState(initialCount)
  const [syncedCount, setSyncedCount] = useState(initialCount)
  const [isPending, startTransition] = useTransition()

  // Category chips are soft navigations and rows are keyed by id, so a request
  // present in two lists keeps THIS instance across the navigation. Without
  // this reset the snapshot taken at mount would outlive every fresher server
  // count. Adjusting state during render is the documented React answer to
  // "reset state when a prop changes" and re-runs before anything paints.
  if (initialCount !== syncedCount) {
    setSyncedCount(initialCount)
    setCount(initialCount)
  }

  const voted = votedIds.has(requestId)
  const label = voted ? t('remove', { title }) : t('action', { title })

  function handleClick() {
    if (votesLoading || isPending) return

    const previousCount = count
    const nextVoted = !voted
    setCount((current) => Math.max(0, current + (nextVoted ? 1 : -1)))

    startTransition(async () => {
      try {
        const result = await vote(requestId, nextVoted)
        if (result.ok) {
          setCount(result.count)
          trackFeatureRequestVoted(requestId, result.voted)
          return
        }

        setCount(previousCount)
        toast.error(result.error === 'rate_limited' ? t('rateLimited') : t('error'))
      } catch {
        setCount(previousCount)
        toast.error(t('error'))
      }
    })
  }

  return (
    <Button
      type="button"
      variant="secondary"
      // No live region on purpose: the pressed state changes on the control
      // that still holds focus, so the screen reader re-announces it already.
      aria-label={label}
      aria-pressed={voted}
      aria-busy={isPending}
      disabled={votesLoading || isPending}
      onClick={handleClick}
      className={cn(
        // Rest fill is warm surface, not card: a white bordered control on a
        // white row reads as a hairline box under this flat-elevation system.
        'h-auto w-14 flex-col gap-1 rounded-xl border-border bg-secondary px-0 py-2 text-foreground',
        // `primary-dark`, not `primary`: kiln on a 10% kiln tint measures 4.31:1
        // for the 13px count, under the 4.5:1 AA floor.
        voted &&
          'border-primary bg-primary/10 text-primary-dark hover:bg-primary/10 hover:text-primary-dark',
        className,
      )}
      data-ph-no-autocapture
    >
      <ChevronUp className="size-4" strokeWidth={voted ? 2.5 : 2} aria-hidden="true" />
      <span className="type-metadata tabular-nums text-current">{count}</span>
    </Button>
  )
}
