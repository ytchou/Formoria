'use client'

import { useTranslations } from 'next-intl'
import type { WizardStep } from '@/lib/schemas/brand-edit'
import {
  OnboardingStepList,
  type OnboardingStepItem,
} from './onboarding-step-list'
import { ProgressStepCard } from './progress-step-card'

type WizardSidebarProps = {
  steps: WizardStep[]
  activeStep: number
  completedSteps: Set<number>
  onStepClick: (index: number) => void
}

const STEP_MESSAGE_KEYS = {
  basicInfo: ['wizardStepBasicInfo', 'wizardStepBasicInfoSub'],
  media: ['wizardStepMedia', 'wizardStepMediaSub'],
  links: ['wizardStepLinks', 'wizardStepLinksSub'],
  locations: ['wizardStepLocations', 'wizardStepLocationsSub'],
  reputation: ['wizardStepReputation', 'wizardStepReputationSub'],
} as const

export function WizardSidebar({
  steps,
  activeStep,
  completedSteps,
  onStepClick,
}: WizardSidebarProps) {
  const t = useTranslations('dashboard.edit')

  const stepItems: OnboardingStepItem[] = steps.map((step, index) => {
    const [labelKey] = STEP_MESSAGE_KEYS[step.key]
    return {
      key: step.key,
      title: t(labelKey),
      description: undefined,
      isHighlighted: index === activeStep,
      isCompleted: completedSteps.has(index),
    }
  })

  const activeStepItem = stepItems[activeStep]
  const progressText = t('wizardProgress', {
    current: activeStep + 1,
    total: steps.length,
  })

  return (
    <>
      <aside className="sticky top-6 hidden w-80 self-start md:block">
        <ProgressStepCard
          title={t('wizardSidebarTitle')}
          progressText={progressText}
          progressLabel={progressText}
          value={activeStep + 1}
          max={steps.length}
        >
          <nav aria-label={progressText}>
            <OnboardingStepList steps={stepItems} onStepClick={onStepClick} />
          </nav>
        </ProgressStepCard>
      </aside>

      <details className="rounded-xl border border-border bg-card shadow-sm md:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 py-3 text-left type-subsection-title outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span className="block truncate">
              {activeStepItem
                ? activeStepItem.title
                : t('wizardProgress', {
                    current: activeStep + 1,
                    total: steps.length,
                  })}
            </span>
          </span>
          <span className="ml-3 type-caption">
            {progressText}
          </span>
        </summary>

        <nav className="border-t border-border p-3" aria-label={progressText}>
          <OnboardingStepList steps={stepItems} onStepClick={onStepClick} />
        </nav>

        <div className="border-t border-border px-4 py-3">
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={progressText}
            aria-valuemin={0}
            aria-valuemax={steps.length}
            aria-valuenow={activeStep + 1}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{
                width: `${steps.length ? ((activeStep + 1) / steps.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      </details>
    </>
  )
}
