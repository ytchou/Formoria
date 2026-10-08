'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { Flag } from 'lucide-react'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { buttonVariants } from '@/components/ui/button'
import { DialogLoadingContent } from '@/components/brands/dialog-loading-content'

// Click-gated: the dialog body only reaches the browser once the trigger is
// primed. `ssr: false` because it only ever renders inside an open dialog
// portal — there is no server markup to preserve. `loading` guarantees the
// portal (overlay + focus trap) still mounts while the chunk is in flight.
const ReportDialogContent = dynamic(
  () => import('@/components/brands/report-dialog-content').then((m) => m.ReportDialogContent),
  { ssr: false, loading: () => <DialogLoadingContent size="form" /> },
)

interface ReportDialogProps {
  brandId: string
  brandSlug: string
  /**
   * Controlled mode: pass `open` and the dialog renders no trigger of its own.
   * The caller (an overflow menu item) owns opening it.
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function ReportDialog({
  brandId,
  brandSlug,
  open,
  onOpenChange,
}: ReportDialogProps) {
  const t = useTranslations('brandDetail.report')
  const isControlled = open !== undefined
  // Once primed the content stays mounted, so its state survives close/reopen
  // exactly as it did when the body was statically imported.
  const [primed, setPrimed] = useState(false)
  // Lives here rather than in the body so the close handler can clear it
  // without the body chunk being involved.
  const [reportedField, setReportedField] = useState('')
  const prime = () => setPrimed(true)
  // Controlled mode has no trigger to prime on hover/focus, so the body mounts
  // the moment it opens; closing then pins it mounted like the trigger path.
  const showBody = primed || open === true

  function handleOpenChange(next: boolean) {
    if (!next) setReportedField('')
    if (isControlled) {
      if (!next) prime()
      onOpenChange?.(next)
    }
  }

  return (
    <Dialog
      {...(isControlled ? { open } : {})}
      onOpenChange={handleOpenChange}
    >
      {!isControlled && (
        <DialogTrigger
          className={buttonVariants({ variant: 'secondary', className: 'shrink-0' })}
          onPointerEnter={prime}
          onPointerDown={prime}
          onFocus={prime}
          onClick={prime}
        >
          <Flag className="size-4" />
          {t('trigger')}
        </DialogTrigger>
      )}
      {showBody && (
        <ReportDialogContent
          brandId={brandId}
          brandSlug={brandSlug}
          reportedField={reportedField}
          setReportedField={setReportedField}
        />
      )}
    </Dialog>
  )
}
