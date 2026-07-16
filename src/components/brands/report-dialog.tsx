'use client'

import { useEffect, useState } from 'react'
import { useActionState } from 'react'
import NextLink from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Flag } from 'lucide-react'
import { submitReportAction, type ReportState } from '@/app/[locale]/brands/[slug]/actions'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { usePathname } from '@/i18n/navigation'
import { signInHref } from '@/i18n/locale-preference'
import { useUser } from '@/lib/auth/use-user'

interface ReportDialogProps {
  brandId: string
  brandSlug: string
}

export function ReportDialog({ brandId, brandSlug }: ReportDialogProps) {
  const t = useTranslations('brandDetail.report')
  const locale = useLocale() as 'zh-TW' | 'en'
  const pathname = usePathname()
  const { user, loading } = useUser()
  const [state, action, pending] = useActionState<ReportState, FormData>(submitReportAction, {})
  const [selectedReasons, setSelectedReasons] = useState<Set<string>>(new Set())
  const [alreadyReported, setAlreadyReported] = useState(false)
  const ownershipDisputeSelected = selectedReasons.has('ownership_dispute')
  const disputeRequiresSignIn = ownershipDisputeSelected && !loading && !user

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setAlreadyReported(!!window.localStorage.getItem(`report:${brandSlug}`))
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [brandSlug])

  useEffect(() => {
    if (state.success) {
      window.localStorage.setItem(`report:${brandSlug}`, '1')
      const timeoutId = window.setTimeout(() => {
        setAlreadyReported(true)
      }, 0)

      return () => window.clearTimeout(timeoutId)
    }
  }, [brandSlug, state.success])

  const reasons = [
    { value: 'not_mit', label: t('reasonNotMit') },
    { value: 'incorrect_info', label: t('reasonIncorrectInfo') },
    { value: 'broken_link', label: t('reasonBrokenLink') },
    { value: 'inappropriate', label: t('reasonInappropriate') },
    { value: 'ownership_dispute', label: t('reasonOwnershipDispute') },
  ]

  return (
    <Dialog>
      <DialogTrigger
        className={buttonVariants({ variant: 'secondary', className: 'shrink-0' })}
      >
        <Flag className="size-4" />
        {t('trigger')}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {state.success ? (
          <>
            <p className="py-4 type-card-description">{t('success')}</p>
            <DialogFooter>
              <DialogClose render={<Button variant="secondary" />}>
                {t('close')}
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form action={action}>
            <input type="hidden" name="brandId" value={brandId} />
            <input type="hidden" name="reason" value={[...selectedReasons].join(',')} />

            <div className="space-y-4 py-4">
              {alreadyReported && (
                <p className="rounded-lg border border-border p-3 type-card-description">
                  {t('alreadyReported')}
                </p>
              )}

              <div className="space-y-2">
                <Label className="type-body-emphasis">{t('description')}</Label>
                <div className="grid grid-cols-2 gap-2">
                  {reasons.map(({ value, label }) => (
                    <Button
                      key={value}
                      type="button"
                      variant={selectedReasons.has(value) ? 'primary' : 'secondary'}
                      size="chip"
                      aria-pressed={selectedReasons.has(value)}
                      className="min-h-12 justify-start"
                      onClick={() => {
                        setSelectedReasons((prev) => {
                          if (prev.has(value)) {
                            const next = new Set(prev)
                            next.delete(value)
                            return next
                          }
                          if (value === 'ownership_dispute') {
                            return new Set([value])
                          }
                          const next = new Set(prev)
                          next.delete('ownership_dispute')
                          next.add(value)
                          return next
                        })
                      }}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>

              {disputeRequiresSignIn ? (
                <div className="space-y-3">
                  <p className="type-card-description">{t('disputeSignInPrompt')}</p>
                  <NextLink
                    href={signInHref(pathname, locale)}
                    className={buttonVariants({
                      variant: 'secondary',
                      className: 'min-h-12 focus-visible:ring-2 focus-visible:ring-brand',
                    })}
                  >
                    {t('disputeSignInCta')}
                  </NextLink>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="report-notes" className="type-body-emphasis">
                    {t('notesPlaceholder')}
                  </Label>
                  <Textarea id="report-notes" name="notes" maxLength={1000} rows={3} />
                </div>
              )}

              {state.error && (
                <p className="text-sm text-destructive">{state.error}</p>
              )}
            </div>

            <DialogFooter>
              <DialogClose render={<Button variant="secondary" />}>
                {t('close')}
              </DialogClose>
              {!disputeRequiresSignIn && (
                <Button
                  type="submit"
                  disabled={
                    pending ||
                    alreadyReported ||
                    selectedReasons.size === 0 ||
                    (ownershipDisputeSelected && loading)
                  }
                >
                  {pending ? t('submitting') : t('submit')}
                </Button>
              )}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
