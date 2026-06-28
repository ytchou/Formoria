'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CONTACT_EMAILS } from '@/lib/constants'
import { verifyMitAction } from '@/app/[locale]/(protected)/dashboard/actions'

type MitStatus = 'unverified' | 'verified'

const STATUS_CLASSES: Record<MitStatus, string> = {
  unverified: 'bg-[#F5F4F1] text-[#7C7570]',
  verified: 'bg-[#EAF3E8] text-[#2D5A27]',
}

type Props = {
  brandId: string
  brandName: string
  brandSlug: string
  mitStatus: MitStatus
  mitEvidence?: {
    mit_smile_cert?: string
    mit_smile_listed?: boolean
  }
  isOwner: boolean
}

export function MitStatusCard({
  brandId,
  brandName,
  brandSlug,
  mitStatus,
  mitEvidence,
  isOwner,
}: Props) {
  const t = useTranslations('dashboard.mit')
  const [certNumber, setCertNumber] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  const mailtoHref = `mailto:${CONTACT_EMAILS.operations}?subject=${encodeURIComponent(`MIT 驗證申請 — ${brandName} (${brandSlug})`)}`

  function handleVerify() {
    if (!certNumber.trim()) return
    setError(null)
    setSuccess(false)
    startTransition(async () => {
      const result = await verifyMitAction(brandId, certNumber.trim())
      if (result?.error) {
        if (result.error === 'cert_not_found') {
          setError(t('certNotFound'))
        } else if (result.error === 'cert_expired') {
          setError(t('certExpired'))
        } else {
          setError(result.error)
        }
      } else {
        setSuccess(true)
      }
    })
  }

  return (
    <Card className="border-[#E5E0D8] bg-white shadow-none">
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-bold text-foreground">
          {t('title')}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 text-left">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[mitStatus]}`}
          >
            {t(`status.${mitStatus}`)}
          </span>
        </div>

        <p className="text-sm text-muted-foreground">
          {t(`description.${mitStatus}`)}
        </p>

        {mitEvidence?.mit_smile_cert ? (
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">
              {t('certLabel')}
            </p>
            <p className="mt-1 text-sm">{mitEvidence.mit_smile_cert}</p>
          </div>
        ) : null}

        {mitStatus === 'unverified' && isOwner ? (
          <div className="space-y-2">
            {success ? (
              <p className="text-sm font-medium text-[#2D5A27]">{t('verifySuccess')}</p>
            ) : (
              <>
                <label htmlFor="mit-cert-input" className="text-xs font-medium uppercase text-muted-foreground">
                  {t('certLabel')}
                </label>
                <div className="flex gap-2">
                  <input
                    id="mit-cert-input"
                    type="text"
                    value={certNumber}
                    onChange={(e) => setCertNumber(e.target.value)}
                    placeholder={t('certPlaceholder')}
                    disabled={isPending}
                    aria-invalid={error ? true : undefined}
                    className={`flex-1 rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${error ? 'border-red-500' : 'border-input'}`}
                  />
                  <button
                    type="button"
                    onClick={handleVerify}
                    disabled={isPending || !certNumber.trim()}
                    className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t('verifyButton')}
                  </button>
                </div>
                {error ? (
                  <p className="text-xs text-destructive">{error}</p>
                ) : null}
              </>
            )}
          </div>
        ) : mitStatus !== 'verified' ? (
          <a
            className="inline-flex min-h-[44px] items-center text-sm font-semibold text-[#C4693B] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            href={mailtoHref}
          >
            {t('resubmitCta')}
          </a>
        ) : null}
      </CardContent>
    </Card>
  )
}
