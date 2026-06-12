'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import {
  trackOnboardingBannerCtaClick,
  trackOnboardingBannerDismiss,
  trackOnboardingBannerShown,
} from '@/lib/analytics'
import type { ActionNudge } from '@/lib/services/brand-health'

type WelcomeBannerProps = {
  claimedAt: string | null
  completionFraction: number
  slug: string
  topAction?: Pick<ActionNudge, 'label' | 'anchor' | 'points'>
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function WelcomeBanner({
  claimedAt,
  completionFraction,
  slug,
  topAction,
}: WelcomeBannerProps) {
  const t = useTranslations('dashboard.onboarding.banner')
  const [dismissed, setDismissed] = useState(false)
  const [mountedAt] = useState(() => Date.now())
  const claimedAtTime = claimedAt === null ? null : new Date(claimedAt).getTime()
  const isWithinClaimWindow =
    claimedAtTime !== null && mountedAt - claimedAtTime <= SEVEN_DAYS_MS
  const shouldShow =
    claimedAt !== null && isWithinClaimWindow && completionFraction < 1
  const shouldTrackShownRef = useRef(shouldShow)

  useEffect(() => {
    if (shouldTrackShownRef.current) {
      trackOnboardingBannerShown(slug)
    }
  }, [slug])

  if (!shouldShow || dismissed) {
    return null
  }

  const actions = [
    { label: t('action1'), hint: t('action1Hint') },
    { label: t('action2'), hint: t('action2Hint') },
    { label: t('action3'), hint: t('action3Hint') },
  ]

  return (
    <section className="rounded-lg border border-[#E5E0D8] bg-white p-6">
      <div className="space-y-1">
        <h2 className="text-base font-bold text-[#1C1C1C]">{t('title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <ol className="mt-4 space-y-4">
        {actions.map((action, index) => (
          <li key={action.label} className="flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F5F4F1] text-xs font-semibold text-[#2F5D50]">
              {index + 1}
            </span>
            <div className="space-y-1">
              <p className="text-sm font-medium text-[#1C1C1C]">{action.label}</p>
              <p className="text-xs text-muted-foreground">{action.hint}</p>
            </div>
          </li>
        ))}
        {topAction ? (
          <li className="flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#2F5D50] text-xs font-semibold text-white">
              &gt;
            </span>
            <Link
              className="flex min-w-0 flex-1 items-start justify-between gap-3 rounded-md border border-[#2F5D50] bg-[#F5F4F1] px-3 py-2 hover:bg-[#F5F4F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F5D50] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
              href={`/dashboard/brands/${slug}/edit${topAction.anchor}`}
            >
              <span className="min-w-0 space-y-1">
                <span className="inline-flex rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-[#2F5D50]">
                  {t('topPick')}
                </span>
                <span className="block text-sm font-medium text-[#1C1C1C]">
                  {topAction.label}
                </span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-[#2F5D50]">
                +{topAction.points}
              </span>
            </Link>
          </li>
        ) : null}
      </ol>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Link
          className="inline-flex min-h-[48px] items-center justify-center rounded-lg bg-[#2F5D50] px-6 py-3 text-sm font-medium text-white hover:bg-[#1F3F36] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F5D50] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          href={`/dashboard/brands/${slug}/edit#media`}
          onClick={() => trackOnboardingBannerCtaClick(slug)}
        >
          {t('cta')}
        </Link>
        <button
          className="min-h-[48px] text-sm text-muted-foreground underline hover:text-[#1C1C1C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F5D50] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          type="button"
          onClick={() => {
            trackOnboardingBannerDismiss(slug)
            setDismissed(true)
          }}
        >
          {t('dismiss')}
        </button>
      </div>
    </section>
  )
}
