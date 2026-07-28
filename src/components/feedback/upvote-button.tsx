'use client'

import { ChevronUp, LockKeyhole } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useFeatureRequestVotes } from '@/hooks/use-feature-request-votes'
import { usePathname } from '@/i18n/navigation'
import { localizePath } from '@/i18n/locale-preference'
import { trackFeatureRequestVoted } from '@/lib/analytics'
import { useUser } from '@/lib/auth/use-user'
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
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const { user, loading: userLoading } = useUser()
  const { votedIds, loading: votesLoading, vote } = useFeatureRequestVotes()
  const [count, setCount] = useState(initialCount)
  const [isPending, startTransition] = useTransition()

  const voted = votedIds.has(requestId)
  const signedOut = !userLoading && !user
  const label = signedOut
    ? t('signIn', { title })
    : voted
      ? t('remove', { title })
      : t('action', { title })

  function handleClick() {
    if (userLoading || votesLoading || isPending) return

    if (!user) {
      // Same handoff as SaveBrandButton: the cookie is what brings the visitor
      // back to the board instead of the generic post-auth landing page.
      const localizedPath = localizePath(pathname, locale)
      document.cookie = `post_auth_next=${encodeURIComponent(
        localizedPath,
      )}; path=/; max-age=600; SameSite=Lax`
      router.push('/auth/sign-in')
      return
    }

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
      disabled={userLoading || votesLoading || isPending}
      onClick={handleClick}
      className={cn(
        // Rest fill is warm surface, not card: a white bordered control on a
        // white row reads as a hairline box under this flat-elevation system.
        'h-auto w-14 flex-col gap-0.5 rounded-lg border-border bg-secondary px-0 py-2 text-foreground',
        voted &&
          'border-primary bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary',
        className,
      )}
      data-ph-no-autocapture
    >
      {signedOut ? (
        <LockKeyhole
          data-auth-required-indicator
          className="size-3.5 text-muted-foreground"
          aria-hidden="true"
        />
      ) : (
        <ChevronUp className="size-4" strokeWidth={voted ? 2.5 : 2} aria-hidden="true" />
      )}
      <span className="type-metadata tabular-nums text-current">{count}</span>
    </Button>
  )
}
