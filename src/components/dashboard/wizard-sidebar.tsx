'use client'

import { ListChecks } from 'lucide-react'
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
  const progressPercent = steps.length
    ? Math.round(((activeStep + 1) / steps.length) * 100)
    : 0

  return (
    <>
      <aside className="sticky top-6 hidden w-60 self-start border-r border-border bg-card md:block">
        <div className="flex items-center gap-3 px-4 pt-4 pb-2">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ListChecks className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="font-heading text-base font-bold leading-tight text-foreground">
              {t('wizardSidebarTitle')}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('wizardProgress', {
                current: activeStep + 1,
                total: steps.length,
              })}
            </p>
          </div>
        </div>
        <nav
          className="p-3"
          aria-label={t('wizardProgress', {
            current: activeStep + 1,
            total: steps.length,
          })}
        >
          <OnboardingStepList className="space-y-1" steps={stepItems} onStepClick={onStepClick} />
        </nav>
      </aside>

      <details className="border-b border-border bg-card md:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 py-3 text-left text-sm font-semibold text-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
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
}: {
  value: number
  label: string
}) {
  return (
    <div className="border-t border-border p-4">
      <div
        className="h-2 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  )
}
