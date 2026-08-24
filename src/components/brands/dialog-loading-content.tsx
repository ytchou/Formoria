'use client'

import { useTranslations } from 'next-intl'
import { DialogContent, DialogTitle, type DialogSize } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface DialogLoadingContentProps {
  className?: string
  size?: DialogSize
}

// `loading` fallback for the click-gated dialog bodies. Without it an opening
// dialog mounts nothing at all until its chunk lands — no overlay, no focus
// trap, no visible response. That window is guaranteed (not merely possible) on
// the report -> evidence handoff, where a synthetic trigger click starts the
// chunk request and opens the dialog in the same commit.
export function DialogLoadingContent({ className, size = 'form' }: DialogLoadingContentProps) {
  const t = useTranslations('common')

  return (
    <DialogContent
      showCloseButton={false}
      aria-busy="true"
      // THE WIDTH IS THE SIZE PROP, NOT A className. The skeleton has to hand
      // off to a body of the same width, and the body names its width with the
      // same vocabulary — a literal here could only ever agree by coincidence.
      size={size}
      className={cn('gap-3 p-4 sm:p-6', className)}
    >
      {/* NOT inside a `DialogHeader`: the title is sr-only, and a ruled header
          above an invisible title draws a rule over nothing. */}
      <DialogTitle className="sr-only">{t('loading')}</DialogTitle>
      <div className="space-y-3" aria-hidden="true">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-24 w-full" />
      </div>
    </DialogContent>
  )
}
