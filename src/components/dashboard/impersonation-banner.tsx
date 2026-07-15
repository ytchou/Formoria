'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { endImpersonationAction } from '@/lib/actions/impersonation'
import { useUser } from '@/lib/auth/use-user'

function getMinutesLeft(expiresAt: number) {
  return Math.max(0, Math.ceil((expiresAt - Date.now() / 1000) / 60))
}

export function ImpersonationBanner() {
  const router = useRouter()
  const t = useTranslations('impersonation')
  const { viewer, viewerLoading, refreshViewer } = useUser()
  const [isPending, startTransition] = useTransition()
  const [minutesLeft, setMinutesLeft] = useState(0)
  const impersonation = viewer.impersonation
  const expiresAt = impersonation?.expiresAt ?? 0

  useEffect(() => {
    if (!expiresAt) return

    const updateMinutesLeft = () => {
      const remaining = getMinutesLeft(expiresAt)
      setMinutesLeft(remaining)
      return remaining
    }
    const timeout = setTimeout(() => {
      updateMinutesLeft()
    }, 0)
    const interval = setInterval(() => {
      const remaining = updateMinutesLeft()
      if (remaining <= 0) {
        clearInterval(interval)
        void refreshViewer().then(() => router.refresh())
      }
    }, 30_000)
    return () => {
      clearTimeout(timeout)
      clearInterval(interval)
    }
  }, [expiresAt, refreshViewer, router])

  if (viewerLoading || !impersonation) return null

  const brandName = impersonation.brandName

  return (
    <div className="border-b border-mit-verified/20 bg-mit-verified-bg px-3 py-2">
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {/* ui-exception: inverse badge on dark impersonation banner; single site, no variant warranted */}
          <Badge className="bg-background text-mit-verified">
            {brandName}
          </Badge>
          <span className="truncate type-body-emphasis text-mit-verified">
            {t('banner', { brandName })}
          </span>
          <span className="type-caption text-mit-verified" suppressHydrationWarning>
            {t.raw('timeRemaining').replace('{minutes}', String(minutesLeft))}
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
              await refreshViewer()
              router.push('/dashboard')
            })
          }}
        >
          {t('exit')}
        </Button>
      </div>
    </div>
  )
}
