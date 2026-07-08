'use client'

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
import { ProgressStepCard } from './progress-step-card'

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
    <ProgressStepCard
      title={t('card.title')}
      progressText={t('progress', {
        completed: completedCount,
        total: ONBOARDING_STEPS.length,
      })}
      progressLabel={t('card.progressLabel')}
      value={completedCount}
      max={ONBOARDING_STEPS.length}
    >
      <OnboardingStepList steps={stepItems} showArrow />
    </ProgressStepCard>
  )
}
