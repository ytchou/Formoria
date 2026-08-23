'use client'

import { ChevronUp } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { UnstyledButton } from '@/components/ui/unstyled-button'
import { DISABLED_STATE, FOCUS_RING } from '@/components/ui/control-surface'
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
    <UnstyledButton
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
        'flex w-14 flex-col items-center gap-1 rounded-control border border-border bg-secondary py-2 text-foreground transition-colors',
        FOCUS_RING,
        DISABLED_STATE,
        // Hover is pinned to the rest values on purpose: a voted chip must not
        // repaint on hover, and the accent on its own 10% tint stays above the
        // 4.5:1 AA floor for the 13px count.
        voted &&
          'border-accent bg-accent/10 text-accent hover:bg-accent/10 hover:text-accent',
        className,
      )}
      data-ph-no-autocapture
    >
      <ChevronUp className="size-4" strokeWidth={voted ? 2.5 : 2} aria-hidden="true" />
      <span className="type-metadata tabular-nums text-current">{count}</span>
    </UnstyledButton>
  )
}
