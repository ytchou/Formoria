// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWizardController } from '../use-wizard-controller'

const steps = [{ key: 'basicInfo' }, { key: 'media' }, { key: 'links' }]

describe('useWizardController', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/submit?source=test')
  })

  it('shares validation, completion, and step query synchronization', async () => {
    const validateStep = vi.fn().mockResolvedValue(true)
    const beforeStepChange = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() =>
      useWizardController({
        steps,
        initialStep: 0,
        validateStep,
        beforeStepChange,
      })
    )

    await act(() => result.current.continueToNext())

    expect(validateStep).toHaveBeenCalledWith('basicInfo')
    expect(beforeStepChange).toHaveBeenCalledWith('basicInfo', 1)
    expect(result.current.activeStep).toBe(1)
    expect(result.current.completedSteps.has(0)).toBe(true)
    expect(window.location.search).toContain('step=1')
    expect(window.location.search).toContain('source=test')
  })

  it('does not navigate when validation or the persistence adapter fails', async () => {
    const validateStep = vi.fn().mockResolvedValue(false)
    const beforeStepChange = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() =>
      useWizardController({ steps, validateStep, beforeStepChange })
    )

    await act(() => result.current.continueToNext())
    expect(result.current.activeStep).toBe(0)
    expect(beforeStepChange).not.toHaveBeenCalled()
  })

  it('keeps persistence optional for final-only submission flows', async () => {
    const validateStep = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() =>
      useWizardController({ steps, validateStep })
    )

    await act(() => result.current.goToStep(2))
    expect(result.current.activeStep).toBe(2)
  })

  it('marks a directly saved step as completed', async () => {
    const { result } = renderHook(() =>
      useWizardController({ steps }),
    )

    act(() => result.current.markStepCompleted(2))

    expect(result.current.completedSteps.has(2)).toBe(true)
  })
})
