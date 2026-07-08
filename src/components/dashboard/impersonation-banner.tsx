'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { endImpersonationAction } from '@/lib/actions/impersonation'

type ImpersonationBannerProps = {
  brandName: string
  expiresAt: number
  initialMinutesLeft: number
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
  initialMinutesLeft,
  labels,
}: ImpersonationBannerProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [minutesLeft, setMinutesLeft] = useState(initialMinutesLeft)

  useEffect(() => {
    setMinutesLeft(getMinutesLeft(expiresAt))
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
    <div className="border-b border-amber-300/40 bg-amber-50 px-3 py-2">
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge className="bg-amber-200 text-amber-900">
            {brandName}
          </Badge>
          <span className="truncate text-sm font-semibold text-amber-900">
            {labels.banner}
          </span>
          <span className="text-xs text-amber-700">
            {labels.timeRemaining.replace('{minutes}', String(minutesLeft))}
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-amber-300 text-amber-900 hover:bg-amber-100"
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
