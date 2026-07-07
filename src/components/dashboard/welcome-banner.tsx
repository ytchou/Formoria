'use client'

import { ListChecks } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { visitDashboardWalkthroughStep } from '@/app/[locale]/(protected)/dashboard/brands/[slug]/walkthrough-actions'
import {
  ONBOARDING_STEPS,
  type OnboardingStep,
  type OnboardingStepKey,
} from '@/lib/services/brand-onboarding'
import {
  OnboardingStepList,
  type OnboardingStepItem,
} from './onboarding-step-list'

type WelcomeBannerProps = {
  brandId: string
  completedCount: number
  nextStep: OnboardingStepKey | null
  slug: string
  steps: OnboardingStep[]
}

export function WelcomeBanner({
  brandId,
  completedCount,
  nextStep,
  slug,
  steps,
}: WelcomeBannerProps) {
  const t = useTranslations('dashboard.onboarding')

  const percentage = (completedCount / ONBOARDING_STEPS.length) * 100

  const stepItems: OnboardingStepItem[] = steps.map((step) => ({
    key: step.key,
    title: t(`steps.${step.key}.title`),
    description: t(`steps.${step.key}.description`),
    isHighlighted: step.key === nextStep,
    isCompleted: step.status === 'complete',
    statusLabel: t(`status.${step.status}`),
    action: visitDashboardWalkthroughStep.bind(null, brandId, slug, step.key),
  }))

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ListChecks className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-lg font-bold text-foreground">
            {t('card.title')}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t('progress', {
              completed: completedCount,
              total: ONBOARDING_STEPS.length,
            })}
          </p>
        </div>
      </div>

      <div
        className="mt-4 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={t('card.progressLabel')}
        aria-valuemin={0}
        aria-valuemax={ONBOARDING_STEPS.length}
        aria-valuenow={completedCount}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${percentage}%` }}
        />
      </div>

      <OnboardingStepList steps={stepItems} showArrow className="mt-5" />
    </section>
  )
}
