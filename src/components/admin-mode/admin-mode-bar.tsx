'use client'

import { useEffect, useState, useTransition } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { setAdminModeAction } from './actions'

type AdminModeBarProps = {
  labels: {
    god: string
    viewer: string
    enter: string
    exit: string
    banner: string
  }
}

export function AdminModeBar({ labels }: AdminModeBarProps) {
  const [mode, setMode] = useState<'god' | 'viewer' | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const m = document.cookie.match(/(?:^|;\s*)fm_mode=(god|viewer)/)?.[1]
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(m === 'viewer' ? 'viewer' : m === 'god' ? 'god' : null)
  }, [])

  if (mode === null) return null

  const isViewer = mode === 'viewer'
  const next = isViewer ? 'god' : 'viewer'
  const buttonLabel = isViewer ? labels.exit : labels.enter

  return (
    <div
      className={cn(
        'fixed top-0 inset-x-0 z-50 border-b px-3 py-1.5',
        isViewer
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-border bg-secondary text-foreground'
      )}
    >
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant={isViewer ? 'destructive' : 'outline'}>
            {isViewer ? labels.viewer : labels.god}
          </Badge>
          {isViewer ? (
            <span className="truncate text-sm font-semibold">{labels.banner}</span>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant={isViewer ? 'destructive' : 'secondary'}
          disabled={isPending}
          onClick={() => {
            startTransition(() => {
              void setAdminModeAction(next)
            })
          }}
        >
          {buttonLabel}
        </Button>
      </div>
    </div>
  )
}
