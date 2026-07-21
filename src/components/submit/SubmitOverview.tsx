'use client'

import { useState, useTransition } from 'react'
import NextLink from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Link, useRouter } from '@/i18n/navigation'
import { signInHref } from '@/i18n/locale-preference'
import { trackSubmissionPathSelected } from '@/lib/analytics'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { surfaceCardStyles } from '@/components/ui/card'
import { Check, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type SubmitOverviewProps = {
  ownerPath?: string
  recommendPath?: string
  isLoggedIn?: boolean
  hasOwnedBrand?: boolean
}

export default function SubmitOverview({
  ownerPath = '/submit/owner',
  recommendPath = '/submit/recommend',
  isLoggedIn = false,
  hasOwnedBrand = false,
}: SubmitOverviewProps) {
  const t = useTranslations('submit.overview')
  const locale = useLocale()
  const router = useRouter()
  const [isOwnerLimitOpen, setIsOwnerLimitOpen] = useState(false)
  const [isNavigating, startNavigation] = useTransition()

  function handleRecommendationNavigation() {
    startNavigation(() => {
      try {
        router.push(recommendPath)
      } catch {
        toast.error(t('ownerLimitNavigationError'))
      }
    })
  }

  return (
    <main className="page-gutter mx-auto max-w-5xl py-20">
      <div className="max-w-3xl">
        <h1 className="text-balance type-page-title-large">{t('heading')}</h1>
        <p className="mt-4 type-body-muted">{t('description')}</p>
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <section className={surfaceCardStyles({ padding: 'lg' })}>
          <p className="type-eyebrow-muted">{t('recommendEyebrow')}</p>
          <h2 className="mt-2 type-section-title-large text-foreground">
            {t('recommendTitle')}
          </h2>
          <p className="mt-3 type-card-description">
            {t('recommendDescription')}
          </p>
          <ul className="mt-5 space-y-2.5">
            {[
              t('recommendPoint1'),
              t('recommendPoint2'),
              t('recommendPoint3'),
            ].map((point) => (
              <li
                key={point}
                className="flex items-start gap-2 rounded-lg border border-border/70 bg-background/50 px-3 py-2.5"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 inline-flex size-5 items-center justify-center rounded-full border border-cta/25 bg-cta/10 text-cta"
                >
                  <Check className="size-3" />
                </span>
                <span className="type-body-muted">{point}</span>
              </li>
            ))}
          </ul>
          <Link
            href={recommendPath}
            data-ph-no-autocapture
            onClick={() => trackSubmissionPathSelected('recommend', isLoggedIn)}
            className={cn(
              buttonVariants({ variant: 'primary', tone: 'cta' }),
              'mt-6',
            )}
          >
            {t('recommendCta')}
          </Link>
        </section>

        <section className={surfaceCardStyles({ padding: 'lg' })}>
          <p className="type-eyebrow-muted">{t('ownerEyebrow')}</p>
          <h2 className="mt-2 type-section-title-large text-foreground">
            {t('ownerTitle')}
          </h2>
          <p className="mt-3 type-card-description">{t('ownerDescription')}</p>
          <ul className="mt-5 space-y-2.5">
            {[t('ownerPoint1'), t('ownerPoint2'), t('ownerPoint3')].map(
              (point) => (
                <li
                  key={point}
                  className="flex items-start gap-2 rounded-lg border border-border/70 bg-background/50 px-3 py-2.5"
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 inline-flex size-5 items-center justify-center rounded-full border border-cta/25 bg-cta/10 text-cta"
                  >
                    <Check className="size-3" />
                  </span>
                  <span className="type-body-muted">{point}</span>
                </li>
              ),
            )}
          </ul>
          {hasOwnedBrand ? (
            <>
              <Button
                type="button"
                tone="cta"
                className="mt-6 min-h-12"
                data-ph-no-autocapture
                onClick={() => {
                  trackSubmissionPathSelected('claim', true)
                  setIsOwnerLimitOpen(true)
                }}
              >
                {t('ownerCtaLoggedIn')}
              </Button>
              <AlertDialog
                open={isOwnerLimitOpen}
                onOpenChange={setIsOwnerLimitOpen}
              >
                <AlertDialogContent className="max-h-[calc(100dvh-2rem)] !max-w-[calc(100%-2rem)] gap-6 overflow-y-auto p-6 sm:!max-w-lg sm:p-8">
                  <AlertDialogCancel
                    variant="ghost"
                    size="large"
                    className="absolute top-2 right-2"
                    aria-label={t('ownerLimitCloseCta')}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </AlertDialogCancel>
                  <AlertDialogHeader className="!place-items-center gap-3 pt-4 !text-center">
                    <span
                      aria-hidden="true"
                      className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"
                    >
                      <Info className="size-5" />
                    </span>
                    <AlertDialogTitle className="type-section-title-large">
                      {t('ownerLimitTitle')}
                    </AlertDialogTitle>
                    <AlertDialogDescription className="max-w-md text-center">
                      {t('ownerLimitDescription')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter className="mx-0 mb-0 rounded-none bg-transparent px-0 pb-0 pt-4 sm:[&>*]:flex-1">
                    <AlertDialogCancel size="large">
                      {t('ownerLimitCancelCta')}
                    </AlertDialogCancel>
                    <Button
                      type="button"
                      tone="cta"
                      size="large"
                      disabled={isNavigating}
                      onClick={handleRecommendationNavigation}
                    >
                      {t('ownerLimitRecommendCta')}
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : isLoggedIn ? (
            <Link
              href={ownerPath}
              data-ph-no-autocapture
              onClick={() => trackSubmissionPathSelected('claim', true)}
              className={cn(
                buttonVariants({ variant: 'primary', tone: 'cta' }),
                'mt-6',
              )}
            >
              {t('ownerCtaLoggedIn')}
            </Link>
          ) : (
            <NextLink
              href={signInHref(ownerPath, locale)}
              data-ph-no-autocapture
              onClick={() => trackSubmissionPathSelected('claim', false)}
              className={cn(
                buttonVariants({ variant: 'primary', tone: 'cta' }),
                'mt-6',
              )}
            >
              {t('ownerCta')}
            </NextLink>
          )}
        </section>
      </div>
    </main>
  )
}
