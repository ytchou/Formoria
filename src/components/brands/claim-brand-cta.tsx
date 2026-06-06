'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRef, useState, useTransition, type FormEvent } from 'react'
import { submitClaimAction } from '@/app/[locale]/brands/[slug]/actions'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type ClaimBrandCtaProps = {
  brandId: string
}

type ClaimProofType = 'domain_email' | 'social_post' | 'business_registration'

type FeedbackState =
  | { type: 'idle' }
  | { type: 'success'; message: string }
  | { type: 'error'; message: string; authRequired?: boolean }

const proofOptions: Array<{
  value: ClaimProofType
  labelZh: string
  labelEn: string
}> = [
  {
    value: 'domain_email',
    labelZh: '官方網域信箱',
    labelEn: 'Domain email',
  },
  {
    value: 'social_post',
    labelZh: '社群帳號發文',
    labelEn: 'Social post',
  },
  {
    value: 'business_registration',
    labelZh: '商業登記資料',
    labelEn: 'Business registration',
  },
]

function isClaimProofType(value: FormDataEntryValue | null): value is ClaimProofType {
  return proofOptions.some((option) => option.value === value)
}

function isAuthError(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes('sign in') || normalized.includes('登入') || normalized.includes('authenticate')
}

export function ClaimBrandCta({ brandId }: ClaimBrandCtaProps) {
  const pathname = usePathname()
  const formRef = useRef<HTMLFormElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [proofType, setProofType] = useState<ClaimProofType>('domain_email')
  const [feedback, setFeedback] = useState<FeedbackState>({ type: 'idle' })
  const [isPending, startTransition] = useTransition()

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
        message: '請選擇有效的認領證明類型 / Please choose a valid proof type.',
      })
      return
    }

    const proofUrl = formData.get('proofUrl')?.toString().trim() ?? ''
    const proofNotes = formData.get('proofNotes')?.toString().trim() ?? ''

    setFeedback({ type: 'idle' })

    startTransition(() => {
      void (async () => {
        try {
          const result = await submitClaimAction({
            brandId,
            proofType: selectedProofType,
            proofUrl: proofUrl || undefined,
            proofNotes: proofNotes || undefined,
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
            message: '我們已收到你的認領申請，會盡快審核。 / Your claim has been submitted.',
          })
        } catch {
          setFeedback({
            type: 'error',
            message: '提交失敗，請稍後再試。 / Something went wrong. Please try again.',
          })
        }
      })()
    })
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5 text-left">
      <div className="space-y-1">
        <p className="text-base font-semibold text-foreground">這是社群整理品牌頁</p>
        <p className="text-sm text-muted-foreground">
          Community listing. If you represent this brand, submit proof to claim and manage it.
        </p>
      </div>

      {!isOpen ? (
        <button
          type="button"
          onClick={openForm}
          className="inline-flex min-h-12 items-center justify-center rounded-lg bg-cta px-6 py-3 text-left text-cta-foreground transition-all hover:bg-cta/90 active:scale-[0.98]"
        >
          <span className="flex flex-col">
            <span className="text-sm font-semibold">認領這個品牌</span>
            <span className="text-xs font-medium text-cta-foreground/85">Claim this brand</span>
          </span>
        </button>
      ) : (
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-foreground">提交認領證明</h2>
            <p className="text-xs text-muted-foreground">
              Submit proof of ownership so we can review your claim request.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="claim-proof-type" className="block text-sm font-medium text-foreground">
              認領證明類型
              <span className="ml-1 text-xs font-normal text-muted-foreground">Proof type</span>
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
                  {option.labelZh} / {option.labelEn}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="claim-proof-url" className="block text-sm font-medium text-foreground">
              證明連結
              <span className="ml-1 text-xs font-normal text-muted-foreground">Proof URL (optional)</span>
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
              補充說明
              <span className="ml-1 text-xs font-normal text-muted-foreground">Notes (optional)</span>
            </label>
            <Textarea
              id="claim-proof-notes"
              name="proofNotes"
              placeholder="可補充品牌身份、角色或相關說明 / Add any helpful context."
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
                  立即登入 / Sign in
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
              <span className="flex flex-col">
                <span className="text-sm font-semibold">提交認領申請</span>
                <span className="text-xs font-medium text-cta-foreground/85">
                  {isPending ? 'Submitting claim...' : 'Submit claim'}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-border bg-card px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              取消 / Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
