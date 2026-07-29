'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { LockKeyhole, MapPin } from 'lucide-react'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { buttonVariants } from '@/components/ui/button'
import { useUser } from '@/lib/auth/use-user'

// Click-gated: the dialog body (form, upload hook, server action binding) is a
// separate chunk. `ssr: false` because it only ever renders inside an open
// dialog portal — there is no server markup to preserve.
const EvidenceDialogContent = dynamic(
  () => import('@/components/brands/evidence-dialog-content').then((m) => m.EvidenceDialogContent),
  { ssr: false },
)

interface EvidenceDialogProps {
  brandId: string
  brandSlug: string
}

export function EvidenceDialog({ brandId, brandSlug }: EvidenceDialogProps) {
  const t = useTranslations('brandDetail.evidence')
  const { user, loading } = useUser()
  // Once primed the content stays mounted, so its state survives close/reopen
  // exactly as it did when the body was statically imported.
  const [primed, setPrimed] = useState(false)
  // `onClick` is not redundant with `onPointerDown`: the report dialog opens
  // this one via a programmatic `element.click()`, which fires no pointer event.
  const prime = () => setPrimed(true)

  return (
    <Dialog>
      <DialogTrigger
        data-evidence-dialog-trigger
        title={!loading && !user ? t('signInPrompt') : undefined}
        className={buttonVariants({ variant: 'secondary', className: 'shrink-0' })}
        onPointerEnter={prime}
        onPointerDown={prime}
        onFocus={prime}
        onClick={prime}
      >
        <MapPin className="size-4" />
        {t('trigger')}
        {!loading && !user && (
          <LockKeyhole
            data-auth-required-indicator
            className="size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
        )}
      </DialogTrigger>
      {primed && <EvidenceDialogContent brandId={brandId} brandSlug={brandSlug} />}
    </Dialog>
  )
}
