'use client'

import { useTransition } from 'react'
import { BarChart3, BookOpen, HeartPulse, Pencil, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { surfaceCardStyles } from '@/components/ui/card'

type WelcomeBannerProps = {
  brandSlug: string
  dismissAction: () => Promise<void>
}

const tipLinkClassName =
  'flex min-h-12 items-center gap-3 rounded-lg border border-border p-4 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function WelcomeBanner({
  brandSlug,
  dismissAction,
}: WelcomeBannerProps) {
  const t = useTranslations('dashboard.welcome')
  const [isPending, startTransition] = useTransition()

  return (
    <section
      aria-labelledby="welcome-banner-title"
      className={surfaceCardStyles({ elevated: true })}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 id="welcome-banner-title" className="type-card-title">
            {t('title')}
          </h2>
          <p className="type-section-description">{t('subtitle')}</p>
        </div>
        <Button
          aria-label={t('dismiss')}
          disabled={isPending}
          onClick={() => {
            startTransition(async () => {
              await dismissAction()
            })
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X aria-hidden="true" />
        </Button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          className={tipLinkClassName}
          href={`/dashboard/brands/${brandSlug}/edit`}
        >
          <Pencil aria-hidden="true" className="size-5 shrink-0 text-primary" />
          <span className="type-body-emphasis">{t('tips.editProfile')}</span>
        </Link>

        <a className={tipLinkClassName} href="#profile-completeness">
          <HeartPulse
            aria-hidden="true"
            className="size-5 shrink-0 text-primary"
          />
          <span className="type-body-emphasis">{t('tips.checkHealth')}</span>
        </a>

        <Link
          className={tipLinkClassName}
          href={`/dashboard/brands/${brandSlug}/analytics`}
        >
          <BarChart3
            aria-hidden="true"
            className="size-5 shrink-0 text-primary"
          />
          <span className="type-body-emphasis">{t('tips.viewAnalytics')}</span>
        </Link>

        <Link className={tipLinkClassName} href="/faq#for-owners">
          <BookOpen
            aria-hidden="true"
            className="size-5 shrink-0 text-primary"
          />
          <span className="type-body-emphasis">{t('tips.readFaq')}</span>
        </Link>
      </div>
    </section>
  )
}
