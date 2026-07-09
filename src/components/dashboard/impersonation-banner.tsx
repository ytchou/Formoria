'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { endImpersonationAction } from '@/lib/actions/impersonation'

type ImpersonationBannerProps = {
  brandName: string
  expiresAt: number
  labels: {
    banner: string
    exit: string
    timeRemaining: string
  }
}

function getMinutesLeft(expiresAt: number) {
  return Math.max(0, Math.ceil((expiresAt - Date.now() / 1000) / 60))
}

export function ImpersonationBanner({
  brandName,
  expiresAt,
  labels,
}: ImpersonationBannerProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [minutesLeft, setMinutesLeft] = useState(() => getMinutesLeft(expiresAt))

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = getMinutesLeft(expiresAt)
      setMinutesLeft(remaining)
      if (remaining <= 0) {
        clearInterval(interval)
        router.refresh()
      }
    }, 30_000)
    return () => clearInterval(interval)
  }, [expiresAt, router])

  return (
    <div className="border-b border-mit-verified/20 bg-mit-verified-bg px-3 py-2">
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge className="bg-background text-mit-verified">
            {brandName}
          </Badge>
          <span className="truncate type-body-emphasis text-mit-verified">
            {labels.banner}
          </span>
          <span className="type-caption text-mit-verified">
            {labels.timeRemaining.replace('{minutes}', String(minutesLeft))}
          </span>
        </div>
        <Button
          type="button"
          size="compact"
          variant="secondary"
          className="border-mit-verified/30 text-mit-verified hover:bg-background"
          disabled={isPending}
          onClick={() => {
            startTransition(async () => {
              await endImpersonationAction()
              router.push('/dashboard')
            })
          }}
        >
          {labels.exit}
        </Button>
      </div>
    </div>
  )
}
