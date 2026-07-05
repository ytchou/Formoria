'use client'

import { CheckIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { WizardStep } from '@/lib/schemas/brand-edit'
import { cn } from '@/lib/utils'

type WizardSidebarProps = {
  steps: WizardStep[]
  activeStep: number
  completedSteps: Set<number>
  onStepClick: (index: number) => void
}

export function WizardSidebar({
  steps,
  activeStep,
  completedSteps,
  onStepClick,
}: WizardSidebarProps) {
  const t = useTranslations('dashboard.edit')
  const activeStepData = steps[activeStep]
  const progressPercent = steps.length
    ? Math.round(((activeStep + 1) / steps.length) * 100)
    : 0

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-[260px] flex-col border-r border-border bg-card md:flex">
        <nav className="flex-1 py-6" aria-label={t('wizardProgress', {
          current: activeStep + 1,
          total: steps.length,
        })}>
          {steps.map((step, index) => (
            <WizardStepButton
              key={step.key}
              step={step}
              index={index}
              isActive={index === activeStep}
              isCompleted={completedSteps.has(index)}
              onClick={onStepClick}
            />
          ))}
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
              {activeStepData
                ? `${activeStepData.label} · ${activeStepData.sublabel}`
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

        <nav className="border-t border-border py-2" aria-label={t('wizardProgress', {
          current: activeStep + 1,
          total: steps.length,
        })}>
          {steps.map((step, index) => {
            const isActive = index === activeStep
            const isCompleted = completedSteps.has(index)

            return (
              <button
                key={step.key}
                type="button"
                data-active={isActive ? 'true' : undefined}
                data-completed={isCompleted ? 'true' : undefined}
                onClick={() => onStepClick(index)}
                className={cn(
                  'flex min-h-12 w-full items-center gap-3 border-l-2 px-4 py-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  isActive
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-transparent hover:bg-secondary'
                )}
              >
                <StepIndicator
                  index={index}
                  isActive={isActive}
                  isCompleted={isCompleted}
                />
                <span className="min-w-0 flex-1 truncate">
                  {step.label} · {step.sublabel}
                </span>
              </button>
            )
          })}
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

function WizardStepButton({
  step,
  index,
  isActive,
  isCompleted,
  onClick,
}: {
  step: WizardStep
  index: number
  isActive: boolean
  isCompleted: boolean
  onClick: (index: number) => void
}) {
  return (
    <button
      type="button"
      data-active={isActive ? 'true' : undefined}
      data-completed={isCompleted ? 'true' : undefined}
      onClick={() => onClick(index)}
      className={cn(
        'flex min-h-12 w-full items-center gap-3 border-l-2 px-5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        isActive
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-transparent hover:bg-secondary'
      )}
    >
      <StepIndicator
        index={index}
        isActive={isActive}
        isCompleted={isCompleted}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {step.label}
        </span>
        <span
          className={cn(
            'mt-0.5 block truncate text-xs',
            isActive ? 'text-primary-foreground/80' : 'text-muted-foreground'
          )}
        >
          {step.sublabel}
        </span>
      </span>
    </button>
  )
}

function StepIndicator({
  index,
  isActive,
  isCompleted,
}: {
  index: number
  isActive: boolean
  isCompleted: boolean
}) {
  return (
    <span
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
        isActive && 'bg-primary-foreground text-primary',
        !isActive && isCompleted && 'bg-primary text-primary-foreground',
        !isActive && !isCompleted && 'bg-secondary text-muted-foreground'
      )}
    >
      {isCompleted ? <CheckIcon className="h-3 w-3" /> : index + 1}
    </span>
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
