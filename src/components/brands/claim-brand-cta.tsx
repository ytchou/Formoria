'use client'

import { Upload } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useRef, useState, useTransition, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { submitClaimAction } from '@/app/[locale]/brands/[slug]/actions'
import { Button, buttonVariants } from '@/components/ui/button'
import { surfaceCardStyles } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useImageUpload } from '@/components/upload/useImageUpload'
import { Link, usePathname } from '@/i18n/navigation'
import { useUser } from '@/lib/auth/use-user'
import {
  CLAIM_PROOF_TYPES,
  PROOF_TYPE_I18N_KEYS,
  type ClaimProofType,
} from '@/lib/services/claim-proofs'
import { cn } from '@/lib/utils'

type ClaimBrandCtaProps = {
  brandId: string
  hasPendingClaim?: boolean
  hasOwnedBrand?: boolean
  removalSlot?: ReactNode
}

type ProofState = {
  selected: boolean
  url: string
  imageKey: string
  note: string
}

type FeedbackState =
  | { type: 'idle' }
  | { type: 'pending'; domainEmailVerificationSentTo?: string }
  | { type: 'error'; message: string; authRequired?: boolean }

type UploadHookState = {
  upload: (file: File) => Promise<{ url: string | null; key: string | null } | null>
  uploading?: boolean
  progress?: number
  status?: string
  url?: string | null
  key?: string | null
  error?: string | null
}

const INITIAL_PROOFS = CLAIM_PROOF_TYPES.reduce(
  (acc, type) => ({
    ...acc,
    [type]: {
      selected: false,
      url: '',
      imageKey: '',
      note: '',
    },
  }),
  {} as Record<ClaimProofType, ProofState>,
)
const IMAGE_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const BUSINESS_DOC_ACCEPTED_TYPES = [...IMAGE_ACCEPTED_TYPES, 'application/pdf']
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isAuthError(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes('sign in') || normalized.includes('authenticate')
}

function hasRequiredEvidence(type: ClaimProofType, proof: ProofState) {
  if (type === 'domain_email') {
    return EMAIL_PATTERN.test(proof.url.trim())
  }

  return Boolean(proof.imageKey)
}

function ClaimProofUpload({
  brandId,
  proofType,
  userId,
  label,
  hint,
  accept,
  acceptedTypes,
  onUploaded,
}: {
  brandId: string
  proofType: ClaimProofType
  userId: string
  label: string
  hint: string
  accept: string
  acceptedTypes: string[]
  onUploaded: (imageKey: string) => void
}) {
  const t = useTranslations('brands.claimCta')
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadPath = `${userId}/${brandId}`
  const uploadState = useImageUpload({
    bucket: 'claim-proofs',
    path: uploadPath,
    acceptedTypes,
    uploadFields: { proofType },
  }) as UploadHookState
  const uploading = uploadState.uploading ?? uploadState.status === 'uploading'

  async function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    const result = await uploadState.upload(file)
    if (result?.key) {
      onUploaded(result.key)
    }
    event.target.value = ''
  }

  return (
    <div className="space-y-2">
      <p className="type-body-emphasis">{label}</p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex min-h-24 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted px-4 py-4 type-metadata transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
        <span>{uploading ? t('uploadingLabel') : hint}</span>
      </button>
      <input
        ref={inputRef}
        id={`claim-${proofType}-image`}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={handleFileSelect}
      />
      {typeof uploadState.progress === 'number' && uploadState.progress > 0 && (
        <p className="type-caption">{uploadState.progress}%</p>
      )}
      {uploadState.error && <p className="text-xs text-destructive">{uploadState.error}</p>}
    </div>
  )
}

export function ClaimBrandCta({
  brandId,
  hasPendingClaim = false,
  hasOwnedBrand = false,
  removalSlot,
}: ClaimBrandCtaProps) {
  const t = useTranslations('brands.claimCta')
  const claimErrorsT = useTranslations('brandDetail.claim.errors')
  const locale = useLocale() as 'zh-TW' | 'en'
  const pathname = usePathname()
  const { user } = useUser()
  const [isOpen, setIsOpen] = useState(false)
  const [proofs, setProofs] = useState<Record<ClaimProofType, ProofState>>(INITIAL_PROOFS)
  const [mitSmileCert, setMitSmileCert] = useState('')
  const [feedback, setFeedback] = useState<FeedbackState>(
    hasPendingClaim ? { type: 'pending' } : { type: 'idle' },
  )
  const [isPending, startTransition] = useTransition()
  const userId = user?.id ?? 'anonymous'
  const selectedProofs = CLAIM_PROOF_TYPES.filter((type) => proofs[type].selected)
  const selectedCount = selectedProofs.length
  const stillNeedCount = Math.max(0, 1 - selectedCount)
  const selectedProofsHaveEvidence = selectedProofs.every((type) => {
    const proof = proofs[type]
    return hasRequiredEvidence(type, proof)
  })
  const canSubmit = selectedCount >= 1 && selectedProofsHaveEvidence && !isPending

  function openForm() {
    setIsOpen(true)
    setFeedback({ type: 'idle' })
  }

  function updateProof(type: ClaimProofType, patch: Partial<ProofState>) {
    setProofs((current) => ({
      ...current,
      [type]: {
        ...current[type],
        ...patch,
      },
    }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!canSubmit) return

    const claimProofs = selectedProofs
      .map((type) => {
        const proof = proofs[type]
        return {
          type,
          url: proof.url.trim() || undefined,
          imageKey: proof.imageKey || undefined,
          note: proof.note.trim() || undefined,
        }
      })
      .filter((proof) => proof.url || proof.imageKey)

    setFeedback({ type: 'idle' })

    startTransition(() => {
      void (async () => {
        try {
          const result = await submitClaimAction({
            brandId,
            proofs: claimProofs,
            mitSmileCert: mitSmileCert.trim() || undefined,
            locale,
          })

          if ('error' in result) {
            setFeedback({
              type: 'error',
              message: result.error,
              authRequired: isAuthError(result.error),
            })
            return
          }

          setFeedback({
            type: 'pending',
            domainEmailVerificationSentTo: result.domainEmailVerificationSentTo,
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

  if (hasOwnedBrand) {
    return (
      <section className={surfaceCardStyles({ className: 'space-y-3 text-left' })}>
        <p className="type-card-title">{t('ownerLimitTitle')}</p>
        <p className="type-section-description">{t('ownerLimitBody')}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href="/dashboard" className="text-sm font-semibold text-primary underline underline-offset-4">
            {t('manageBrand')}
          </Link>
          {removalSlot}
        </div>
      </section>
    )
  }

  if (feedback.type === 'pending') {
    return (
      <section className={surfaceCardStyles({ className: 'space-y-3 text-left' })}>
        <p className="type-card-title">{t('pendingTitle')}</p>
        <p className="type-section-description">
          {feedback.domainEmailVerificationSentTo
            ? t('pendingDomainEmailBody', { email: feedback.domainEmailVerificationSentTo })
            : t('pendingBody')}
        </p>
      </section>
    )
  }

  return (
    <section className={surfaceCardStyles({ className: 'space-y-4 text-left' })}>
      <div className="space-y-1">
        <p className="type-card-title">{t('communityTitle')}</p>
        <p className="type-card-description">{t('communityListing')}</p>
      </div>

      {!isOpen ? (
        <div className="space-y-3">
          {!user && (
            <p className="type-card-description">{claimErrorsT('notLoggedIn')}</p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {user ? (
              <Button
                type="button"
                variant="primary" tone="cta"
                onClick={openForm}
              >
                {t('claimButton')}
              </Button>
            ) : (
              <Link
                href={`/auth/sign-in?next=${encodeURIComponent(pathname)}`}
                className={buttonVariants({ variant: 'primary', tone: 'cta' })}
              >
                {t('signIn')}
              </Link>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href="/faq#claim" className="text-xs text-primary underline underline-offset-4">
              {t('whyClaim')}
            </Link>
            {user && removalSlot}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1">
            <h2 className="type-subsection-title">{t('proofHeading')}</h2>
            <p className="type-card-description">{t('pickOneInstruction')}</p>
          </div>

          <div
            className={cn(
              'rounded-lg border px-4 py-3 text-sm',
              stillNeedCount > 0
                ? 'border-border bg-muted text-muted-foreground'
                : canSubmit
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-muted text-muted-foreground',
            )}
            aria-live="polite"
          >
            {stillNeedCount > 0 ? t('stillNeed', { n: stillNeedCount }) : canSubmit ? t('readyToSubmit') : t('pickOneInstruction')}
          </div>

          <div className="space-y-3">
            {CLAIM_PROOF_TYPES.map((type) => {
              const proof = proofs[type]
              const label = t(`proofTypes.${PROOF_TYPE_I18N_KEYS[type]}.label`)
              const description = t(`proofTypes.${PROOF_TYPE_I18N_KEYS[type]}.description`)

              return (
                <div
                  key={type}
                  className={cn(
                    surfaceCardStyles({ className: 'space-y-4', padding: 'sm' }),
                    proof.selected && 'border-primary bg-primary/5',
                  )}
                >
                  <div className="flex gap-3">
                    <input
                      id={`claim-proof-${type}`}
                      type="checkbox"
                      checked={proof.selected}
                      onChange={(event) => updateProof(type, { selected: event.target.checked })}
                      className="mt-1 h-5 w-5 rounded border-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <label htmlFor={`claim-proof-${type}`} className="block min-h-6 cursor-pointer type-subsection-title">
                        {label}
                      </label>
                      <p className="type-card-description">{description}</p>
                      {type === 'domain_email' && (
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {t('proofTypes.domainEmail.helperText')}
                        </p>
                      )}
                      {type === 'business_doc' && (
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {t('proofTypes.businessDoc.privacyNote')}
                        </p>
                      )}
                    </div>
                  </div>

                  {proof.selected && (
                    <div className="grid gap-4 border-t border-border pt-4 md:grid-cols-2">
                      {type === 'domain_email' && (
                        <div className="space-y-2 md:col-span-2">
                          <label htmlFor={`claim-${type}-email`} className="block type-body-emphasis">
                            {t('proofTypes.domainEmail.emailLabel')}
                          </label>
                          <Input
                            id={`claim-${type}-email`}
                            type="email"
                            value={proof.url}
                            onChange={(event) => updateProof(type, { url: event.target.value })}
                            placeholder={t('proofTypes.domainEmail.placeholder')}
                            className="min-h-12 bg-card px-3.5 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring"
                          />
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {t('proofTypes.domainEmail.helperText')}
                          </p>
                        </div>
                      )}

                      {type === 'backend_screenshot' && (
                        <div className="space-y-3 md:col-span-2">
                          <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
                            {(t.raw('proofTypes.backendScreenshot.examples') as string[]).map((example) => (
                              <li key={example}>{example}</li>
                            ))}
                          </ul>
                          <ClaimProofUpload
                            brandId={brandId}
                            proofType={type}
                            userId={userId}
                            label={t('proofTypes.backendScreenshot.uploadLabel')}
                            hint={t('proofTypes.backendScreenshot.uploadHint')}
                            accept="image/*"
                            acceptedTypes={IMAGE_ACCEPTED_TYPES}
                            onUploaded={(imageKey) => updateProof(type, { imageKey })}
                          />
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {t('proofTypes.backendScreenshot.loginNote')}
                          </p>
                        </div>
                      )}

                      {type === 'business_doc' && (
                        <div className="md:col-span-2">
                          <ClaimProofUpload
                            brandId={brandId}
                            proofType={type}
                            userId={userId}
                            label={t('proofTypes.businessDoc.uploadLabel')}
                            hint={t('proofTypes.businessDoc.uploadHint')}
                            accept="application/pdf,image/*"
                            acceptedTypes={BUSINESS_DOC_ACCEPTED_TYPES}
                            onUploaded={(imageKey) => updateProof(type, { imageKey })}
                          />
                        </div>
                      )}

                      <div className="space-y-2 md:col-span-2">
                        <label htmlFor={`claim-${type}-note`} className="block type-body-emphasis">
                          {t('noteLabel')}
                        </label>
                        <Textarea
                          id={`claim-${type}-note`}
                          value={proof.note}
                          onChange={(event) => updateProof(type, { note: event.target.value })}
                          className="min-h-24 bg-card px-3.5 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="space-y-2">
            <label htmlFor="claim-mit-smile-cert" className="block type-body-emphasis">
              {t('mitCertLabel')}
            </label>
            <Input
              id="claim-mit-smile-cert"
              name="mitSmileCert"
              type="text"
              value={mitSmileCert}
              onChange={(event) => setMitSmileCert(event.target.value)}
              className="min-h-12 bg-card px-3.5 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="type-caption">{t('mitCertHint')}</p>
          </div>

          {feedback.type === 'error' && (
            <div aria-live="polite" className="space-y-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <p>{feedback.message}</p>
              {feedback.authRequired && (
                <Link href={`/auth/sign-in?next=${encodeURIComponent(pathname)}`} className="inline-flex font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {t('signIn')}
                </Link>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              type="submit"
              variant="primary" tone="cta"
              disabled={!canSubmit}
            >
              {isPending ? t('submitting') : t('submit')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsOpen(false)}
            >
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
