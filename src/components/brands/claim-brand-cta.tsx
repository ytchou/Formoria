'use client'

import { Upload } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRef, useState, useTransition, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { submitClaimAction } from '@/app/[locale]/brands/[slug]/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useImageUpload } from '@/components/upload/useImageUpload'
import { Link, usePathname } from '@/i18n/navigation'
import { useUser } from '@/lib/auth/use-user'
import { FORMORIA_SOCIALS } from '@/lib/constants'
import {
  CLAIM_PROOF_TYPES,
  PROOF_TYPE_I18N_KEYS,
  type ClaimProofType,
} from '@/lib/services/claim-requests'
import { cn } from '@/lib/utils'

type ClaimBrandCtaProps = {
  brandId: string
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
  | { type: 'pending' }
  | { type: 'error'; message: string; authRequired?: boolean }

type UploadHookState = {
  upload: (file: File, filename: string) => Promise<{ url: string | null; key: string | null } | null>
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

function isAuthError(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes('sign in') || normalized.includes('authenticate')
}

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9.]/g, '_')
}

function ClaimProofUpload({
  brandId,
  proofType,
  userId,
  onUploaded,
}: {
  brandId: string
  proofType: ClaimProofType
  userId: string
  onUploaded: (imageKey: string) => void
}) {
  const t = useTranslations('brands.claimCta')
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadPath = `${userId}/${brandId}`
  const uploadState = useImageUpload({
    bucket: 'claim-proofs',
    path: uploadPath,
  }) as UploadHookState
  const uploading = uploadState.uploading ?? uploadState.status === 'uploading'

  async function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    const filename = `${Date.now()}-${sanitizeFilename(file.name)}`
    const result = await uploadState.upload(file, filename)
    if (result?.key) {
      onUploaded(result.key)
    }
    event.target.value = ''
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">{t('uploadLabel')}</p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex min-h-24 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted px-4 py-4 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
        <span>{uploading ? t('uploadingLabel') : t('uploadHint')}</span>
      </button>
      <input
        ref={inputRef}
        id={`claim-${proofType}-image`}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={handleFileSelect}
      />
      {typeof uploadState.progress === 'number' && uploadState.progress > 0 && (
        <p className="text-xs text-muted-foreground">{uploadState.progress}%</p>
      )}
      {uploadState.error && <p className="text-xs text-destructive">{uploadState.error}</p>}
    </div>
  )
}

export function ClaimBrandCta({ brandId, removalSlot }: ClaimBrandCtaProps) {
  const t = useTranslations('brands.claimCta')
  const pathname = usePathname()
  const { user } = useUser()
  const [isOpen, setIsOpen] = useState(false)
  const [proofs, setProofs] = useState<Record<ClaimProofType, ProofState>>(INITIAL_PROOFS)
  const [mitSmileCert, setMitSmileCert] = useState('')
  const [feedback, setFeedback] = useState<FeedbackState>({ type: 'idle' })
  const [isPending, startTransition] = useTransition()
  const userId = user?.id ?? 'anonymous'
  const selectedProofs = CLAIM_PROOF_TYPES.filter((type) => proofs[type].selected)
  const selectedCount = selectedProofs.length
  const stillNeedCount = Math.max(0, 2 - selectedCount)
  const selectedProofsHaveEvidence = selectedProofs.every((type) => {
    const proof = proofs[type]
    return Boolean(proof.url.trim() || proof.imageKey)
  })
  const canSubmit = selectedCount >= 2 && selectedProofsHaveEvidence && !isPending

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
          })

          if ('error' in result) {
            setFeedback({
              type: 'error',
              message: result.error,
              authRequired: isAuthError(result.error),
            })
            return
          }

          setFeedback({ type: 'pending' })
        } catch {
          setFeedback({
            type: 'error',
            message: t('submitError'),
          })
        }
      })()
    })
  }

  if (feedback.type === 'pending') {
    return (
      <section className="space-y-3 rounded-xl border border-border bg-card p-5 text-left">
        <p className="text-base font-semibold text-foreground">{t('pendingTitle')}</p>
        <p className="text-sm text-muted-foreground">{t('pendingBody')}</p>
        {removalSlot && <div className="border-t border-border pt-3">{removalSlot}</div>}
      </section>
    )
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5 text-left">
      <div className="space-y-1">
        <p className="text-base font-semibold text-foreground">{t('communityTitle')}</p>
        <p className="text-sm text-muted-foreground">{t('communityListing')}</p>
      </div>

      {!isOpen ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={openForm}
              className="inline-flex min-h-12 items-center justify-center rounded-lg bg-cta px-6 py-3 text-left text-cta-foreground transition-all hover:bg-cta/90 active:scale-[0.98]"
            >
              <span className="text-sm font-semibold">{t('claimButton')}</span>
            </button>
            {removalSlot && (
              <>
                {removalSlot}
              </>
            )}
          </div>
          <Link href="/faq#claim" className="block text-xs inline-link">
            {t('whyClaim')}
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-foreground">{t('proofHeading')}</h2>
            <p className="text-sm text-muted-foreground">{t('pickTwoInstruction')}</p>
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
            {stillNeedCount > 0 ? t('stillNeed', { n: stillNeedCount }) : canSubmit ? t('readyToSubmit') : t('pickTwoInstruction')}
          </div>

          <div className="space-y-3">
            {CLAIM_PROOF_TYPES.map((type) => {
              const proof = proofs[type]
              const label = t(`proofTypes.${PROOF_TYPE_I18N_KEYS[type]}.label`)
              const description = t(`proofTypes.${PROOF_TYPE_I18N_KEYS[type]}.description`)
              const disabled = type === 'social_dm' && FORMORIA_SOCIALS.length === 0

              return (
                <div
                  key={type}
                  className={cn(
                    'space-y-4 rounded-xl border border-border bg-card p-4',
                    proof.selected && 'border-primary bg-primary/5',
                    disabled && 'opacity-60',
                  )}
                >
                  <div className="flex gap-3">
                    <input
                      id={`claim-proof-${type}`}
                      type="checkbox"
                      checked={proof.selected}
                      disabled={disabled}
                      title={disabled ? t('socialDisabledHint') : undefined}
                      onChange={(event) => updateProof(type, { selected: event.target.checked })}
                      className="mt-1 h-5 w-5 rounded border-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <label htmlFor={`claim-proof-${type}`} className="block min-h-6 cursor-pointer text-sm font-semibold text-foreground">
                        {label}
                      </label>
                      <p className="text-sm text-muted-foreground">{description}</p>
                      {disabled && <p className="text-xs text-muted-foreground">{t('socialDisabledHint')}</p>}
                    </div>
                  </div>

                  {proof.selected && !disabled && (
                    <div className="grid gap-4 border-t border-border pt-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label htmlFor={`claim-${type}-url`} className="block text-sm font-medium text-foreground">
                          {t('linkLabel')}
                        </label>
                        <Input
                          id={`claim-${type}-url`}
                          type="url"
                          value={proof.url}
                          onChange={(event) => updateProof(type, { url: event.target.value })}
                          placeholder="https://"
                          className="min-h-12 bg-card px-3.5 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      </div>

                      <ClaimProofUpload
                        brandId={brandId}
                        proofType={type}
                        userId={userId}
                        onUploaded={(imageKey) => updateProof(type, { imageKey })}
                      />

                      <div className="space-y-2 md:col-span-2">
                        <label htmlFor={`claim-${type}-note`} className="block text-sm font-medium text-foreground">
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
            <label htmlFor="claim-mit-smile-cert" className="block text-sm font-medium text-foreground">
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
              disabled={!canSubmit}
              className="min-h-12 bg-cta px-6 py-3 text-sm font-semibold text-cta-foreground hover:bg-cta/90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? t('submitting') : t('submit')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsOpen(false)}
              className="min-h-12 px-6 py-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
