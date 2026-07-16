'use client'

import { useCallback, useMemo, useState } from 'react'

type WizardStep<StepKey extends string> = { key: StepKey }

type WizardControllerOptions<StepKey extends string> = {
  steps: readonly WizardStep<StepKey>[]
  initialStep?: number
  initialCompletedSteps?: Iterable<number>
  validateStep?: (stepKey: StepKey) => Promise<boolean>
  beforeStepChange?: (stepKey: StepKey, targetStep: number) => Promise<boolean>
}

export function useWizardController<StepKey extends string>({
  steps,
  initialStep = 0,
  initialCompletedSteps = [],
  validateStep,
  beforeStepChange,
}: WizardControllerOptions<StepKey>) {
  const maxStep = Math.max(steps.length - 1, 0)
  const [activeStep, setActiveStep] = useState(() =>
    Math.max(0, Math.min(initialStep, maxStep))
  )
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(
    () => new Set(initialCompletedSteps)
  )
  const currentStepKey = (steps[activeStep]?.key ??
    steps[0]?.key ??
    '') as StepKey

  const navigateTo = useCallback(
    (targetStep: number) => {
      const nextStep = Math.max(0, Math.min(targetStep, maxStep))
      setActiveStep(nextStep)
      const params = new URLSearchParams(window.location.search)
      params.set('step', String(nextStep))
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}?${params.toString()}`
      )
    },
    [maxStep]
  )

  const transitionTo = useCallback(
    async (targetStep: number, shouldValidate: boolean) => {
      if (targetStep === activeStep) return true
      if (shouldValidate && validateStep) {
        const valid = await validateStep(currentStepKey)
        if (!valid) return false
      }
      if (beforeStepChange) {
        const canLeave = await beforeStepChange(currentStepKey, targetStep)
        if (!canLeave) return false
      }
      if (shouldValidate) {
        setCompletedSteps((previous) => new Set([...previous, activeStep]))
      }
      navigateTo(targetStep)
      return true
    },
    [activeStep, beforeStepChange, currentStepKey, navigateTo, validateStep]
  )

  const goToStep = useCallback(
    (targetStep: number) => transitionTo(targetStep, targetStep > activeStep),
    [activeStep, transitionTo]
  )
  const continueToNext = useCallback(
    () => transitionTo(Math.min(activeStep + 1, maxStep), true),
    [activeStep, maxStep, transitionTo]
  )
  const goBack = useCallback(() => {
    if (activeStep > 0) navigateTo(activeStep - 1)
  }, [activeStep, navigateTo])

  return useMemo(
    () => ({
      activeStep,
      completedSteps,
      currentStepKey,
      navigateTo,
      goToStep,
      continueToNext,
      goBack,
    }),
    [
      activeStep,
      completedSteps,
      continueToNext,
      currentStepKey,
      goBack,
      goToStep,
      navigateTo,
    ]
  )
}
