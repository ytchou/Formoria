'use client'

import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import { useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react'
import { submitClaimAction } from '@/app/[locale]/brands/[slug]/actions'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Link } from '@/i18n/navigation'
import { CONTACT_EMAILS } from '@/lib/constants'

type ClaimBrandCtaProps = {
  brandId: string
  removalSlot?: ReactNode
}

type ClaimProofType = 'domain_email' | 'social_dm' | 'backend_screenshot' | 'business_doc'

const CLAIM_PROOF_TYPES = [
  'domain_email',
  'social_dm',
  'backend_screenshot',
  'business_doc',
] as const

type FeedbackState =
  | { type: 'idle' }
  | { type: 'success'; message: string }
  | { type: 'error'; message: string; authRequired?: boolean }

function isClaimProofType(value: FormDataEntryValue | null): value is ClaimProofType {
  return CLAIM_PROOF_TYPES.some((option) => option === value)
}

function isAuthError(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes('sign in') || normalized.includes('登入') || normalized.includes('authenticate')
}

export function ClaimBrandCta({ brandId, removalSlot }: ClaimBrandCtaProps) {
  const t = useTranslations('brands.claimCta')
  const tSubmit = useTranslations('submit.fields')
  const pathname = usePathname()
  const formRef = useRef<HTMLFormElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [proofType, setProofType] = useState<ClaimProofType>('domain_email')
  const [feedback, setFeedback] = useState<FeedbackState>({ type: 'idle' })
  const [isPending, startTransition] = useTransition()
  const proofOptions: Array<{ value: ClaimProofType; label: string }> = [
    {
      value: 'domain_email',
      label: t('proofTypes.domainEmail.label'),
    },
    {
      value: 'social_dm',
      label: t('proofTypes.socialDm.label'),
    },
    {
      value: 'backend_screenshot',
      label: t('proofTypes.backendScreenshot.label'),
    },
    {
      value: 'business_doc',
      label: t('proofTypes.businessDoc.label'),
    },
  ]

  const signInHref = `/auth/sign-in?next=${encodeURIComponent(pathname)}`

  function openForm() {
    setIsOpen(true)
    setFeedback({ type: 'idle' })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    const selectedProofType = formData.get('proofType')

    if (!isClaimProofType(selectedProofType)) {
      setFeedback({
        type: 'error',
        message: t('proofTypeRequired'),
      })
      return
    }

    const proofUrl = formData.get('proofUrl')?.toString().trim() ?? ''
    const proofNotes = formData.get('proofNotes')?.toString().trim() ?? ''
    const mitSmileCert = formData.get('mitSmileCert')?.toString().trim() ?? ''

    setFeedback({ type: 'idle' })

    startTransition(() => {
      void (async () => {
        try {
          const result = await submitClaimAction({
            brandId,
            proofs: [
              {
                type: selectedProofType,
                url: proofUrl || undefined,
                note: proofNotes || undefined,
              },
            ],
            mitSmileCert: mitSmileCert || undefined,
          })

          if ('error' in result) {
            setFeedback({
              type: 'error',
              message: result.error,
              authRequired: isAuthError(result.error),
            })
            return
          }

          formRef.current?.reset()
          setProofType('domain_email')
          setFeedback({
            type: 'success',
            message: t('submitSuccess'),
          })
        } catch {
          setFeedback({
            type: 'error',
            message: t('submitError'),
          })
        }
      })()
    })
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-muted p-5 text-left">
      <div className="space-y-1">
        <p className="text-base font-semibold text-foreground">{t('communityTitle')}</p>
        <p className="text-sm text-muted-foreground">
          {t('communityListing')}
        </p>
      </div>

      {!isOpen ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={openForm}
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-cta px-6 py-3 text-left text-cta-foreground transition-all hover:bg-cta/90 active:scale-[0.98]"
          >
            <span className="text-sm font-semibold">{t('claimButton')}</span>
          </button>
          <Link href="/faq#claim" className="block text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            {t('whyClaim')}
          </Link>
        </div>
      ) : (
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-foreground">{t('proofHeading')}</h2>
            <p className="text-xs text-muted-foreground">
              {t('proofPrompt')}
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="claim-proof-type" className="block text-sm font-medium text-foreground">
              {t('proofTypeLabel')}
            </label>
            <select
              id="claim-proof-type"
              name="proofType"
              value={proofType}
              onChange={(event) => setProofType(event.target.value as ClaimProofType)}
              className="min-h-12 w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-cta focus:ring-2 focus:ring-cta/20"
            >
              {proofOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="claim-mit-smile-cert" className="block text-sm font-medium text-foreground">
              {tSubmit('mitSmileMarkNumber')}
            </label>
            <Input
              id="claim-mit-smile-cert"
              name="mitSmileCert"
              type="text"
              placeholder={tSubmit('mitSmileMarkNumberPlaceholder')}
              className="h-12 bg-card px-3.5 py-2.5 text-sm focus-visible:border-mit-verified focus-visible:ring-3 focus-visible:ring-mit-verified/20"
            />
            <p className="text-xs text-muted-foreground">
              {tSubmit.rich('mitSmileMarkNumberHelper', {
                email: CONTACT_EMAILS.operations,
                mail: (chunks) => (
                  <a href={`mailto:${CONTACT_EMAILS.operations}`} className="underline underline-offset-4">
                    {chunks}
                  </a>
                ),
              })}
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="claim-proof-url" className="block text-sm font-medium text-foreground">
              {t('proofUrlLabel')}
            </label>
            <Input
              id="claim-proof-url"
              name="proofUrl"
              type="url"
              placeholder="https://"
              className="h-12 bg-card px-3.5 py-2.5 text-sm focus-visible:border-cta focus-visible:ring-3 focus-visible:ring-cta/20"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="claim-proof-notes" className="block text-sm font-medium text-foreground">
              {t('notesLabel')}
            </label>
            <Textarea
              id="claim-proof-notes"
              name="proofNotes"
              placeholder={t('notesPlaceholder')}
              className="min-h-24 bg-card px-3.5 py-2.5 text-sm focus-visible:border-cta focus-visible:ring-3 focus-visible:ring-cta/20"
            />
          </div>

          {feedback.type === 'success' && (
            <p aria-live="polite" className="rounded-lg border border-border bg-secondary px-4 py-3 text-sm text-foreground">
              {feedback.message}
            </p>
          )}

          {feedback.type === 'error' && (
            <div aria-live="polite" className="space-y-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <p>{feedback.message}</p>
              {feedback.authRequired && (
                <Link href={signInHref} className="inline-flex font-medium underline underline-offset-4">
                  {t('signIn')}
                </Link>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex min-h-12 items-center justify-center rounded-lg bg-cta px-6 py-3 text-left text-cta-foreground transition-all hover:bg-cta/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="text-sm font-semibold">
                {isPending ? t('submitting') : t('submit')}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-border bg-card px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      )}

      {removalSlot && (
        <div className="border-t border-border pt-3">
          {removalSlot}
        </div>
      )}
    </section>
  )
}
