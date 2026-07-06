'use client'

import { useState, useEffect, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { verifyMitAction } from '@/app/[locale]/(protected)/dashboard/actions'
import { CONTACT_EMAILS } from '@/lib/constants'

type InlineVerificationProps = {
  brandId: string
  brandName: string
  brandSlug: string
  mitStatus: 'unverified' | 'verified'
  mitEvidence?: { mit_smile_cert?: string; mit_smile_listed?: boolean }
  isOwner: boolean
}

export function InlineVerification({
  brandId,
  brandName,
  brandSlug,
  mitStatus,
  mitEvidence,
  isOwner,
}: InlineVerificationProps) {
  const t = useTranslations('dashboard.mit')

  const DISMISS_KEY = `formoria:dismiss-verification:${brandId}`

  const [dismissed, setDismissed] = useState(false)
  const [certNumber, setCertNumber] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1')
    }
  }, [DISMISS_KEY])

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
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
      <div id="verification" className="mt-3.5 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
        <span className="text-sm font-semibold text-green-700 dark:text-green-400">
          {t('status.verified')}
        </span>
        {mitEvidence?.mit_smile_cert && (
          <span className="font-mono text-xs bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-2 py-0.5 rounded">
            {mitEvidence.mit_smile_cert}
          </span>
        )}
      </div>
    )
  }

  if (isOwner) {
    if (dismissed) return null

    return (
      <div id="verification" className="mt-3.5 rounded-md border p-3.5">
        <div className="flex items-center gap-2 mb-2">
          <span className="h-2 w-2 rounded-full bg-muted-foreground shrink-0" />
          <span className="text-sm font-semibold">
            {t('title')} — {t('status.unverified')}
          </span>
          <button
            onClick={dismiss}
            className="ml-auto text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
            aria-label={t('dismiss')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-2.5">{t('description.unverified')}</p>
        <div className="flex gap-2">
          <Input
            value={certNumber}
            onChange={(e) => setCertNumber(e.target.value)}
            placeholder={t('certPlaceholder')}
            className="h-8 max-w-[200px] font-mono text-xs"
          />
          <Button size="sm" onClick={handleVerify} disabled={!certNumber.trim() || isPending}>
            {t('verifyButton')}
          </Button>
        </div>
        {error && <p className="text-xs text-destructive mt-2">{t(error)}</p>}
        {success && (
          <p className="text-xs text-green-600 dark:text-green-400 mt-2">{t('verifySuccess')}</p>
        )}
      </div>
    )
  }

  return (
    <div id="verification" className="mt-3.5 flex items-center gap-2">
      <span className="h-2 w-2 rounded-full bg-muted-foreground shrink-0" />
      <span className="text-sm text-muted-foreground">{t('status.unverified')}</span>
      <a
        href={`mailto:${CONTACT_EMAILS.operations}?subject=MIT Verification: ${brandName} (${brandSlug})`}
        className="text-xs text-primary underline underline-offset-2"
      >
        {t('resubmitCta')}
      </a>
    </div>
  )
}
