'use client'

import { useState, useSyncExternalStore, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { verifyMitAction } from '@/app/[locale]/(protected)/dashboard/actions'

type InlineVerificationProps = {
  brandId: string
  embedded?: boolean
  mitStatus: 'unverified' | 'verified'
  mitEvidence?: { mit_smile_cert?: string; mit_smile_listed?: boolean }
}

export function InlineVerification({
  brandId,
  embedded = false,
  mitStatus,
  mitEvidence,
}: InlineVerificationProps) {
  const t = useTranslations('dashboard.mit')

  const DISMISS_KEY = `formoria:dismiss-verification:${brandId}`

  const dismissed = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener('storage', onStoreChange)
      window.addEventListener('formoria:verification-dismissed', onStoreChange)
      return () => {
        window.removeEventListener('storage', onStoreChange)
        window.removeEventListener('formoria:verification-dismissed', onStoreChange)
      }
    },
    () => window.localStorage.getItem(DISMISS_KEY) === '1',
    () => false,
  )
  const [certNumber, setCertNumber] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, '1')
    window.dispatchEvent(new Event('formoria:verification-dismissed'))
  }

  function handleVerify() {
    setError(null)
    startTransition(async () => {
      const result = await verifyMitAction(brandId, certNumber)
      if (result?.error) {
        setError(
          result.error === 'cert_not_found' ? 'certNotFound'
          : result.error === 'cert_expired' ? 'certExpired'
          : 'certNotFound',
        )
      } else {
        setSuccess(true)
      }
    })
  }

  if (mitStatus === 'verified') {
    return (
      <div
        id="verification"
        className={embedded ? 'flex items-center gap-2' : 'mt-3.5 flex items-center gap-2'}
      >
        <span className="h-2 w-2 rounded-full bg-verified-green shrink-0" />
        <span className="type-success">
          {t('status.verified')}
        </span>
        {mitEvidence?.mit_smile_cert && (
          <span className="rounded bg-verified-green-bg px-2 py-0.5 font-mono type-caption text-verified-green">
            {mitEvidence.mit_smile_cert}
          </span>
        )}
      </div>
    )
  }

  if (!embedded && dismissed) return null

  return (
    <div
      id="verification"
      className={embedded ? undefined : 'mt-3.5 rounded-md border p-3.5'}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="h-2 w-2 rounded-full bg-muted-foreground shrink-0" />
        <span className="type-body-emphasis">
          {t('title')} — {t('status.unverified')}
        </span>
        {!embedded ? (
          <Button
            type="button"
            onClick={dismiss}
            variant="ghost"
            size="icon"
            className="ml-auto text-muted-foreground hover:text-foreground [&_svg:not([class*=size-])]:size-3.5"
            aria-label={t('dismiss')}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
      <p className="type-caption mb-2.5">{t('description.unverified')}</p>
      <div className="flex gap-2">
        <Input
          value={certNumber}
          onChange={(e) => setCertNumber(e.target.value)}
          placeholder={t('certPlaceholder')}
          className="max-w-[200px] font-mono type-caption"
        />
        <Button size="compact" onClick={handleVerify} disabled={!certNumber.trim() || isPending}>
          {t('verifyButton')}
        </Button>
      </div>
      {error && <p className="mt-2 type-error">{t(error)}</p>}
      {success && (
        <p className="mt-2 type-success">{t('verifySuccess')}</p>
      )}
    </div>
  )
}
