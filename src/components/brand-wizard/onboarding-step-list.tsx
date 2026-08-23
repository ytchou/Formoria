'use client'

import { ArrowRight, Check } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export type OnboardingStepItem = {
  key: string
  title: string
  description?: string
  isHighlighted: boolean
  isCompleted: boolean
  statusLabel?: string
  href?: string
  action?: () => Promise<void>
}

type OnboardingStepListProps = {
  steps: OnboardingStepItem[]
  onStepClick?: (index: number) => void
  showArrow?: boolean
  className?: string
}

export function OnboardingStepList({
  steps,
  onStepClick,
  showArrow = false,
  className,
}: OnboardingStepListProps) {
  return (
    <ol className={cn('space-y-2', className)}>
      {steps.map((step, index) => (
        <StepItem
          key={step.key}
          step={step}
          index={index}
          onStepClick={onStepClick}
          showArrow={showArrow}
        />
      ))}
    </ol>
  )
}

function StepItem({
  step,
  index,
  onStepClick,
  showArrow,
}: {
  step: OnboardingStepItem
  index: number
  onStepClick?: (index: number) => void
  showArrow: boolean
}) {
  const itemClasses = cn(
    'group flex h-auto w-full items-start gap-3 whitespace-normal rounded-control border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
    step.isHighlighted
      ? 'border-accent/30 bg-accent/5 hover:bg-accent/10'
      : 'border-transparent hover:bg-surface'
  )

  const content = (
    <>
      <span
        className={cn(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full',
          step.isCompleted && 'bg-accent text-ground',
          !step.isCompleted &&
            step.isHighlighted &&
            'bg-accent/15 text-accent',
          !step.isCompleted &&
            !step.isHighlighted &&
            'bg-surface text-ink-muted'
        )}
      >
        {step.isCompleted ? (
          <Check className="size-3.5" />
        ) : (
          <span className="type-micro">{index + 1}</span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block type-body-sm font-semibold text-ink">
          {step.title}
        </span>
        {step.description ? (
          <span className="mt-1 block type-metadata">
            {step.description}
          </span>
        ) : null}
        {step.statusLabel ? (
          <span className="mt-1.5 block type-eyebrow">
            {step.statusLabel}
          </span>
        ) : null}
      </span>
      {showArrow && step.isHighlighted ? (
        <ArrowRight className="mt-1 size-4 shrink-0 text-accent transition-transform group-hover:translate-x-0.5" />
      ) : null}
    </>
  )

  if (onStepClick) {
    return (
      <li>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onStepClick(index)}
          className={itemClasses}
          aria-current={step.isHighlighted ? 'step' : undefined}
        >
          {content}
        </Button>
      </li>
    )
  }

  if (step.action) {
    return (
      <li>
        <form action={step.action}>
          <Button
            type="submit"
            variant="ghost"
            className={itemClasses}
            aria-current={step.isHighlighted ? 'step' : undefined}
          >
            {content}
          </Button>
        </form>
      </li>
    )
  }

  if (step.href) {
    return (
      <li>
        <Link
          href={step.href}
          className={itemClasses}
          aria-current={step.isHighlighted ? 'step' : undefined}
        >
          {content}
        </Link>
      </li>
    )
  }

  return (
    <li>
      <div className={cn(itemClasses, 'cursor-default')}>{content}</div>
    </li>
  )
}
