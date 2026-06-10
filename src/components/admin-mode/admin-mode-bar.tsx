'use client'

import { useState, useTransition } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { AdminMode } from '@/lib/auth/admin-mode'
import { cn } from '@/lib/utils'

import { setAdminModeAction } from './actions'

type AdminModeBarProps = {
  mode: AdminMode
  labels: {
    god: string
    viewer: string
    enter: string
    exit: string
    banner: string
  }
}

export function AdminModeBar({ mode: serverMode, labels }: AdminModeBarProps) {
  const [mode, setMode] = useState<AdminMode>(serverMode)
  const [isPending, startTransition] = useTransition()

  const isViewer = mode === 'viewer'
  const next: AdminMode = isViewer ? 'god' : 'viewer'
  const buttonLabel = isViewer ? labels.exit : labels.enter

  return (
    <div
      className={cn(
        'border-b px-3 py-1.5',
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
            setMode(next)
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
