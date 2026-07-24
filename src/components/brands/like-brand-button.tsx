'use client'

import { Heart } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { toast } from 'sonner'

import {
  getBrandLikeStateAction,
  setBrandLikeAction,
} from '@/lib/actions/brand-likes'
import { trackBrandLiked, trackBrandUnliked } from '@/lib/analytics'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type LikeBrandButtonProps = {
  brandId: string
  slug: string
  variant?: 'inline' | 'overlay'
  className?: string
}

const BURST_PARTICLES = [
  { key: 'top', className: '-translate-x-1/2 -translate-y-5' },
  { key: 'top-right', className: 'translate-x-3 -translate-y-4' },
  { key: 'bottom-right', className: 'translate-x-3 translate-y-2' },
  { key: 'bottom', className: '-translate-x-1/2 translate-y-4' },
  { key: 'bottom-left', className: '-translate-x-4 translate-y-2' },
  { key: 'top-left', className: '-translate-x-4 -translate-y-4' },
] as const

export function LikeBrandButton({
  brandId,
  slug,
  variant = 'inline',
  className,
}: LikeBrandButtonProps) {
  const t = useTranslations('likeBrand')
  const format = useFormatter()
  const [count, setCount] = useState(0)
  const [liked, setLiked] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const [showBurst, setShowBurst] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false

    startTransition(async () => {
      try {
        const result = await getBrandLikeStateAction(brandId)
        if (cancelled) return

        if (result.ok) {
          setCount(result.count)
          setLiked(result.liked)
        }
      } catch {
        if (!cancelled) {
          setCount(0)
          setLiked(false)
        }
      } finally {
        if (!cancelled) setIsReady(true)
      }
    })

    return () => {
      cancelled = true
    }
  }, [brandId])

  useEffect(() => {
    if (!showBurst) return

    const timeout = window.setTimeout(() => setShowBurst(false), 600)
    return () => window.clearTimeout(timeout)
  }, [showBurst])

  function handleClick() {
    if (!isReady || isPending) return

    const previousCount = count
    const previousLiked = liked
    const nextLiked = !liked

    setLiked(nextLiked)
    setCount((current) => Math.max(0, current + (nextLiked ? 1 : -1)))
    if (nextLiked) {
      setShowBurst(true)
      trackBrandLiked(brandId, slug)
    } else {
      trackBrandUnliked(brandId, slug)
    }

    startTransition(async () => {
      try {
        const result = await setBrandLikeAction(brandId, nextLiked)
        if (result.ok) {
          setCount(result.count)
          setLiked(result.liked)
          return
        }

        setCount(previousCount)
        setLiked(previousLiked)
        setShowBurst(false)
        toast.error(result.error === 'rate_limited' ? t('rateLimited') : t('error'))
      } catch {
        setCount(previousCount)
        setLiked(previousLiked)
        setShowBurst(false)
        toast.error(t('error'))
      }
    })
  }

  const ariaLabel = t(liked ? 'unlikeAriaLabel' : 'likeAriaLabel', { count })
  const isOverlay = variant === 'overlay'

  return (
    <Button
      type="button"
      variant={isOverlay ? 'overlay' : 'secondary'}
      shape={isOverlay ? 'pill' : 'default'}
      size={isOverlay ? 'icon' : 'default'}
      aria-label={ariaLabel}
      aria-pressed={liked}
      aria-busy={isPending}
      title={!isReady ? t('loading') : ariaLabel}
      disabled={!isReady || isPending}
      className={cn(
        isOverlay
          ? 'z-10 size-12 min-h-12 min-w-12 overflow-visible p-0'
          : 'relative min-h-12 overflow-visible rounded-xl',
        liked && 'border-primary/40 text-primary',
        className,
      )}
      onClick={handleClick}
      data-ph-no-autocapture
      data-like-variant={variant}
      >
      <span className="relative" aria-hidden="true">
        <Heart fill={liked ? 'currentColor' : 'none'} strokeWidth={2} />
        {showBurst && (
          <span className="pointer-events-none absolute left-1/2 top-1/2 motion-reduce:hidden">
            {BURST_PARTICLES.map((particle) => (
              <span
                key={particle.key}
                data-like-burst-particle
                className={cn(
                  'absolute size-1 rounded-full bg-primary motion-safe:animate-ping',
                  particle.className,
                )}
              />
            ))}
          </span>
        )}
      </span>
      {!isOverlay && <span>{count > 0 ? format.number(count) : t('like')}</span>}
    </Button>
  )
}
