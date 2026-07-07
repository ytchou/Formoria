// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WizardSidebar } from '../wizard-sidebar'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/../messages/en.json'
import type { WizardStep } from '@/lib/schemas/brand-edit'

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, className }: React.ComponentProps<'a'>) => (
    <a href={href} className={className}>{children}</a>
  ),
}))

const steps: WizardStep[] = [
  { key: 'basicInfo' },
  { key: 'media' },
  { key: 'links' },
]

function renderSidebar(props = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <WizardSidebar
        steps={steps}
        activeStep={1}
        completedSteps={new Set([0])}
        onStepClick={vi.fn()}
        {...props}
      />
    </NextIntlClientProvider>
  )
}

describe('WizardSidebar', () => {
  it('renders all step labels', () => {
    renderSidebar()
    expect(screen.getByRole('heading', { name: 'Edit brand details' })).toBeInTheDocument()
    expect(screen.getAllByText('Step 2 of 3').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Basic Info').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Media').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Links').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument()
  })

  it('calls onStepClick with step index when clicked', () => {
    const onStepClick = vi.fn()
    renderSidebar({ onStepClick })
    fireEvent.click(screen.getAllByText('Links')[0])
    expect(onStepClick).toHaveBeenCalledWith(2)
  })

  it('marks the active step for assistive technology', () => {
    renderSidebar()
    expect(screen.getAllByRole('button', { name: /Media/ })[0]).toHaveAttribute(
      'aria-current',
      'step',
    )
  })

  it('shows progress bar', () => {
    renderSidebar()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })
})
