// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StepIndicator } from './StepIndicator'

const steps = ['Brand Info', 'Products', 'Links', 'Review']

describe('StepIndicator', () => {
  it('renders all 4 step labels', () => {
    render(<StepIndicator steps={steps} currentStep={0} />)
    steps.forEach((label, i) => {
      expect(
        screen.getByText(new RegExp(`${i + 1}\\s+${label}`))
      ).toBeInTheDocument()
    })
  })

  it('marks current step with active styling', () => {
    render(<StepIndicator steps={steps} currentStep={1} />)
    const activeStep = screen.getByText(/2\s+Products/)
    expect(activeStep.closest('[data-state]')).toHaveAttribute(
      'data-state',
      'active'
    )
  })

  it('marks previous steps as completed', () => {
    render(<StepIndicator steps={steps} currentStep={2} />)
    const step1 = screen.getByText(/1\s+Brand Info/)
    const step2 = screen.getByText(/2\s+Products/)
    expect(step1.closest('[data-state]')).toHaveAttribute(
      'data-state',
      'completed'
    )
    expect(step2.closest('[data-state]')).toHaveAttribute(
      'data-state',
      'completed'
    )
  })

  it('marks future steps as upcoming', () => {
    render(<StepIndicator steps={steps} currentStep={0} />)
    const step3 = screen.getByText(/3\s+Links/)
    expect(step3.closest('[data-state]')).toHaveAttribute(
      'data-state',
      'upcoming'
    )
  })
})
