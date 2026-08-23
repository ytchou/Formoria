import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Check, Home, Plus } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { buttonVariants } from '@/components/ui/button'
import { surfaceCardStyles } from '@/components/ui/card'
import { PageShell } from '@/components/ui/page-shell'
import { routes } from '@/lib/routes'

type ConfirmationPageProps = {
  params: Promise<{ locale: string }>
  searchParams?: Promise<{ ownership?: string; intent?: string }>
}

export async function generateMetadata({ params }: ConfirmationPageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('submit.confirmation.metadata')
  const title = t('title')
  const description = t('description')
  const ogLocale = safeLocale === 'en' ? 'en_US' : 'zh_TW'
  const ogAlternateLocale = safeLocale === 'en' ? 'zh_TW' : 'en_US'

  return {
    title,
    description,
    alternates: buildAlternates(routes.submit.confirmation(), safeLocale),
    openGraph: {
      title,
      description,
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

export default async function ConfirmationPage({ params, searchParams }: ConfirmationPageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('submit.confirmation')
  const resolvedSearchParams = await searchParams
  const ownershipAdjusted = resolvedSearchParams?.ownership === 'community'
  const intent = resolvedSearchParams?.intent === 'owner_claim' ? 'owner_claim' : 'recommend'
  const isOwnerIntent = intent === 'owner_claim'

  return (
    <PageShell
      measure="form"
      className="flex min-h-screen items-center justify-center py-12"
    >
      <div
        className={surfaceCardStyles({
          className: 'w-full prose-measure rounded-surface p-10',
          padding: 'none',
          tone: 'white',
        })}
      >
        {/* Success badge */}
        <div className="flex justify-center">
          <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-accent">
            <Check className="h-8 w-8 text-white" strokeWidth={3} />
          </div>
        </div>

        <h1 className="mt-6 text-center type-section">
          {isOwnerIntent ? t('ownerSubheading') : t('subheading')}
        </h1>

        {ownershipAdjusted ? (
          <p className="mt-4 rounded-surface border border-rule bg-surface p-4 type-body-sm">
            {t('communityOwnershipNotice')}
          </p>
        ) : null}

        {/* Timeline */}
        <div className="mt-8 rounded-surface bg-ground p-6">
          <div className="space-y-4">
              {([
              {
                label: t('timeline.review.label'),
                description: isOwnerIntent
                  ? t('timeline.ownerReview.description')
                  : t('timeline.review.description'),
                active: true,
              },
              {
                label: isOwnerIntent ? t('timeline.ownerResult.label') : t('timeline.result.label'),
                description: isOwnerIntent ? t('timeline.ownerResult.description') : t('timeline.result.description'),
                active: false,
              },
            ] as const).map((step, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={`h-3 w-3 shrink-0 rounded-full ${
                      step.active ? 'bg-accent' : 'bg-rule'
                    }`}
                  />
                  {i < 1 && (
                    <div className="mt-1 h-full w-px bg-rule" />
                  )}
                </div>
                <div className="pb-4">
                  <p
                    className={`type-body-sm font-semibold text-ink ${
                      step.active ? 'text-ink' : 'text-ink-muted'
                    }`}
                  >
                    {step.label}
                  </p>
                  <p className="mt-0.5 type-metadata">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-4 type-body-sm">
          {t.rich('whatNext.learnMore.answer', {
            link: (chunks) => (
              <Link href={routes.gettingStarted()} className="text-ink underline">
                {chunks}
              </Link>
            ),
          })}
        </p>

        {/*
          CTAs, capped at `content-column` (28rem). The card's `prose-measure`
          is right for the copy above it; what was wrong was letting two
          `width="full"` buttons inherit it, which drew each one ~688px wide —
          that reads as a banner, not as a button. The cap belongs to the STACK,
          so the card keeps its measure and the two axes stay off one element.
        */}
        <div className="mx-auto mt-8 content-column space-y-3">
          <Link
            href="/"
            className={buttonVariants({ variant: 'primary', width: 'full' })}
          >
            <Home className="h-4 w-4" />
            {t('cta.explore')}
          </Link>
          <Link
            href={routes.submit.index()}
            className={buttonVariants({ variant: 'secondary', width: 'full' })}
          >
            <Plus className="h-4 w-4" />
            {t('cta.submitAnother')}
          </Link>
        </div>
      </div>
    </PageShell>
  )
}
