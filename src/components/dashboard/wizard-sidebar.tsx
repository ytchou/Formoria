'use client'

import { useTranslations } from 'next-intl'
import type { WizardStep } from '@/lib/schemas/brand-edit'
import {
  OnboardingStepList,
  type OnboardingStepItem,
} from './onboarding-step-list'

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
    const [labelKey, sublabelKey] = STEP_MESSAGE_KEYS[step.key]
    return {
      key: step.key,
      title: t(labelKey),
      description: t(sublabelKey),
      isHighlighted: index === activeStep,
      isCompleted: completedSteps.has(index),
    }
  })

  const activeStepItem = stepItems[activeStep]
  const progressPercent = steps.length
    ? Math.round(((activeStep + 1) / steps.length) * 100)
    : 0

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-[280px] flex-col border-r border-border bg-card md:flex">
        <nav
          className="flex-1 overflow-y-auto p-4"
          aria-label={t('wizardProgress', {
            current: activeStep + 1,
            total: steps.length,
          })}
        >
          <OnboardingStepList steps={stepItems} onStepClick={onStepClick} />
        </nav>

        <WizardProgress
          value={progressPercent}
          label={t('wizardProgress', {
            current: activeStep + 1,
            total: steps.length,
          })}
          withRole
        />
      </aside>

      <details className="border-b border-border bg-card md:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 py-3 text-left text-sm font-semibold text-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span className="block truncate">
              {activeStepItem
                ? `${activeStepItem.title} · ${activeStepItem.description}`
                : t('wizardProgress', {
                    current: activeStep + 1,
                    total: steps.length,
                  })}
            </span>
          </span>
          <span className="ml-3 text-xs text-muted-foreground">
            {progressPercent}%
          </span>
        </summary>

        <nav
          className="border-t border-border p-3"
          aria-label={t('wizardProgress', {
            current: activeStep + 1,
            total: steps.length,
          })}
        >
          <OnboardingStepList steps={stepItems} onStepClick={onStepClick} />
        </nav>

        <WizardProgress
          value={progressPercent}
          label={t('wizardProgress', {
            current: activeStep + 1,
            total: steps.length,
          })}
        />
      </details>
    </>
  )
}

function WizardProgress({
  value,
  label,
  withRole = false,
}: {
  value: number
  label: string
  withRole?: boolean
}) {
  return (
    <div className="border-t border-border p-4">
      <div
        className="h-2 overflow-hidden rounded-full bg-secondary"
        role={withRole ? 'progressbar' : undefined}
        aria-label={withRole ? label : undefined}
        aria-valuemin={withRole ? 0 : undefined}
        aria-valuemax={withRole ? 100 : undefined}
        aria-valuenow={withRole ? value : undefined}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  )
}
