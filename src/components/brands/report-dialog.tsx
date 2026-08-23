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
}

export function ReportDialog({ brandId, brandSlug }: ReportDialogProps) {
  const t = useTranslations('brandDetail.report')
  // Once primed the content stays mounted, so its state survives close/reopen
  // exactly as it did when the body was statically imported.
  const [primed, setPrimed] = useState(false)
  // Lives here rather than in the body so the close handler can clear it
  // without the body chunk being involved.
  const [reportedField, setReportedField] = useState('')
  const prime = () => setPrimed(true)

  function handleOpenChange(open: boolean) {
    if (!open) setReportedField('')
  }

  return (
    <Dialog onOpenChange={handleOpenChange}>
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
      {primed && (
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
