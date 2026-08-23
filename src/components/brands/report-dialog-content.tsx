'use client'

import { useActionState, useEffect, useId, useState } from 'react'
import NextLink from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import {
  BadgeX,
  ChevronRight,
  CircleCheck,
  Info,
  Link2Off,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react'
import { submitReportAction, type ReportState } from '@/app/[locale]/(site)/brands/[slug]/actions'
import {
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { Grid } from '@/components/ui/grid'
import { OptionRow } from '@/components/ui/option-row'
import { UnstyledButton } from '@/components/ui/unstyled-button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Separator } from '@/components/ui/separator'
import { Typography } from '@/components/ui/typography'
import { usePathname } from '@/i18n/navigation'
import { signInHref } from '@/i18n/locale-preference'
import { useUser } from '@/lib/auth/use-user'
import { trackBrandReported } from '@/lib/analytics'
import { cn } from '@/lib/utils'

interface ReportDialogContentProps {
  brandId: string
  brandSlug: string
  // Owned by the shell so the close handler can clear it without this chunk
  // having to be loaded.
  reportedField: string
  setReportedField: (value: string) => void
}

// Split out of `report-dialog.tsx` so the ~260-line form only reaches the
// browser once the user primes the trigger.
export function ReportDialogContent({
  brandId,
  brandSlug,
  reportedField,
  setReportedField,
}: ReportDialogContentProps) {
  const t = useTranslations('brandDetail.report')
  const locale = useLocale() as 'zh-TW' | 'en'
  const pathname = usePathname()
  const { user, loading } = useUser()
  const [state, action, pending] = useActionState<ReportState, FormData>(submitReportAction, {})
  const [selectedReason, setSelectedReason] = useState<string | null>(null)
  const [alreadyReported, setAlreadyReported] = useState(false)
  const [notesLength, setNotesLength] = useState(0)
  const generalHeadingId = useId()
  const representativeHeadingId = useId()
  const authenticatedReasonSelected = selectedReason === 'ownership_dispute' ||
    selectedReason === 'removal_request'
  const reportRequiresSignIn = authenticatedReasonSelected && !loading && !user

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setAlreadyReported(
        selectedReason
          ? !!window.localStorage.getItem(`report:${brandSlug}:${selectedReason}`)
          : false
      )
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [brandSlug, selectedReason])

  useEffect(() => {
    if (state.success && selectedReason) {
      window.localStorage.setItem(`report:${brandSlug}:${selectedReason}`, '1')
      const timeoutId = window.setTimeout(() => {
        setAlreadyReported(true)
        setReportedField('')
      }, 0)

      return () => window.clearTimeout(timeoutId)
    }
  }, [brandSlug, selectedReason, setReportedField, state.success])

  const generalReasons = [
    { value: 'incorrect_info', label: t('reasonIncorrectInfo'), Icon: Info },
    { value: 'broken_link', label: t('reasonBrokenLink'), Icon: Link2Off },
    { value: 'inappropriate', label: t('reasonInappropriate'), Icon: ShieldAlert },
  ]
  const representativeReasons = [
    {
      value: 'ownership_dispute',
      label: t('reasonOwnershipDispute'),
      description: t('ownershipDisputeDescription'),
      Icon: ShieldCheck,
    },
    {
      value: 'removal_request',
      label: t('reasonRemovalRequest'),
      description: t('removalRequestDescription'),
      Icon: BadgeX,
    },
  ]

  function selectReason(value: string) {
    setSelectedReason((current) => current === value ? null : value)
  }

  function handleMitDisputeClick() {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-evidence-dialog-trigger]')?.click()
    })
  }

  return (
    <DialogContent
      showCloseButton={false}
      className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-lg"
    >
      <DialogClose
        render={
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-3 right-3 z-10 sm:top-4 sm:right-4"
            aria-label={t('close')}
          />
        }
      >
        <X className="size-4" aria-hidden="true" />
      </DialogClose>

      <DialogHeader className="flex-row gap-3 p-4 pr-14 sm:p-6 sm:pr-16">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <TriangleAlert className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 space-y-1">
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </div>
      </DialogHeader>

      {state.success ? (
        <div className="flex min-h-0 flex-col">
          <Typography variant="cardDescription" className="flex-1 px-4 py-6 sm:px-6">
            {t('success')}
          </Typography>
          <DialogFooter className="mx-0 mb-0 rounded-b-xl bg-background px-4 py-4 sm:px-6">
            <DialogClose render={<Button variant="secondary" />}>
              {t('close')}
            </DialogClose>
          </DialogFooter>
        </div>
      ) : (
        <form
          action={action}
          className="flex min-h-0 flex-col overflow-hidden"
          onSubmit={() => {
            if (selectedReason) {
              trackBrandReported(brandSlug, selectedReason, 'general')
            }
          }}
        >
          <input type="hidden" name="brandId" value={brandId} />
          <input type="hidden" name="reason" value={selectedReason ?? ''} />

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
            {alreadyReported && (
              <Typography
                variant="cardDescription"
                role="status"
                className="rounded-lg border border-border bg-muted/50 p-3"
              >
                {t('alreadyReported')}
              </Typography>
            )}

            <div role="group" aria-labelledby={generalHeadingId} className="space-y-3">
              <Typography id={generalHeadingId} variant="subsectionTitle">
                {t('reasonHeading')}
              </Typography>
              <Grid cols="pair" gap="tight">
                {generalReasons.map(({ value, label, Icon }) => {
                  const selected = selectedReason === value

                  return (
                    <OptionRow
                      key={value}
                      selected={selected}
                      onClick={() => selectReason(value)}
                      icon={<Icon className="size-5" aria-hidden="true" />}
                      title={label}
                      trailing={
                        selected ? (
                          <CircleCheck className="size-4" aria-hidden="true" />
                        ) : null
                      }
                    />
                  )
                })}
              </Grid>
              <div className="flex min-h-12 items-center gap-3 rounded-[3px] border border-rule bg-muted/50 p-3">
                <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <Typography variant="cardDescription">
                  {t('mitDisputePrompt')}{' '}
                  <DialogClose
                    render={
                      <UnstyledButton
                        // Inline inside a sentence: it sits on the text
                        // baseline, so it takes no control height at all.
                        className="font-medium text-foreground underline underline-offset-4"
                        onClick={handleMitDisputeClick}
                      />
                    }
                  >
                    {t('mitDisputeLink')}
                  </DialogClose>
                </Typography>
              </div>
            </div>

            <Separator />

            <div role="group" aria-labelledby={representativeHeadingId} className="space-y-3">
              <Typography id={representativeHeadingId} variant="subsectionTitle">
                {t('brandRepresentativeHeading')}
              </Typography>
              <div className="grid gap-2">
                {representativeReasons.map(({ value, label, description, Icon }) => {
                  const selected = selectedReason === value

                  return (
                    <OptionRow
                      key={value}
                      selected={selected}
                      onClick={() => selectReason(value)}
                      icon={
                        <Icon
                          className={cn(
                            'size-5 text-muted-foreground',
                            selected && 'text-accent',
                          )}
                          aria-hidden="true"
                        />
                      }
                      title={label}
                      description={description}
                      trailing={
                        selected ? (
                          <CircleCheck className="size-4" aria-hidden="true" />
                        ) : (
                          <ChevronRight
                            className="size-4 text-muted-foreground"
                            aria-hidden="true"
                          />
                        )
                      }
                    />
                  )
                })}
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="report-field">{t('reportFieldLabel')}</Label>
              <NativeSelect
                id="report-field"
                name="reportedField"
                value={reportedField}
                onChange={(event) => setReportedField(event.currentTarget.value)}
              >
                <option value="">{t('reportFieldNone')}</option>
                <option value="name">{t('reportFieldName')}</option>
                <option value="description">{t('reportFieldDescription')}</option>
                <option value="website">{t('reportFieldWebsite')}</option>
                <option value="purchaseUrl">{t('reportFieldPurchaseUrl')}</option>
                <option value="images">{t('reportFieldImages')}</option>
                <option value="socialLinks">{t('reportFieldSocialLinks')}</option>
                <option value="other">{t('reportFieldOther')}</option>
              </NativeSelect>
            </div>

            <Separator />

            {reportRequiresSignIn ? (
              <div className="rounded-lg border border-border bg-muted/50 p-4">
                <Typography variant="cardDescription">
                  {selectedReason === 'removal_request'
                    ? t('removalSignInPrompt')
                    : t('disputeSignInPrompt')}
                </Typography>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="report-notes">{t('notesLabel')}</Label>
                  <span
                    className="type-metadata tabular-nums text-muted-foreground"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {notesLength} / 1000
                  </span>
                </div>
                <Textarea
                  id="report-notes"
                  name="notes"
                  maxLength={1000}
                  rows={4}
                  placeholder={t('notesPlaceholder')}
                  className="min-h-24 resize-y"
                  onChange={(event) => setNotesLength(event.currentTarget.value.length)}
                />
              </div>
            )}

            {state.error && (
              <Typography variant="error" role="alert">{state.error}</Typography>
            )}
          </div>

          <DialogFooter className="mx-0 mb-0 rounded-b-xl bg-background px-4 py-4 sm:px-6">
            <DialogClose render={<Button variant="secondary" />}>
              {t('cancel')}
            </DialogClose>
            {reportRequiresSignIn ? (
              <NextLink
                href={signInHref(pathname, locale)}
                className={buttonVariants({ variant: 'primary' })}
              >
                {t('disputeSignInCta')}
              </NextLink>
            ) : (
              <Button
                type="submit"
                data-ph-no-autocapture
                disabled={
                  pending ||
                  alreadyReported ||
                  !selectedReason ||
                  (authenticatedReasonSelected && loading)
                }
              >
                {pending ? t('submitting') : t('submit')}
              </Button>
            )}
          </DialogFooter>
        </form>
      )}
    </DialogContent>
  )
}
