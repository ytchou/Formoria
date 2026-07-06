// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WizardSidebar } from '../wizard-sidebar'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/../messages/en.json'

const steps = [
  { key: 'basicInfo', label: 'Basic Info', sublabel: '品牌基本資料' },
  { key: 'media', label: 'Media', sublabel: '品牌圖片' },
  { key: 'links', label: 'Links', sublabel: '社群與購買連結' },
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
    expect(screen.getByText('Basic Info')).toBeInTheDocument()
    expect(screen.getByText('Media')).toBeInTheDocument()
    expect(screen.getByText('Links')).toBeInTheDocument()
  })

  it('shows a checkmark for completed steps', () => {
    renderSidebar()
    const step0 = screen.getByText('Basic Info').closest('button')
    expect(step0).toHaveAttribute('data-completed', 'true')
  })

  it('highlights the active step', () => {
    renderSidebar()
    const step1 = screen.getByText('Media').closest('button')
    expect(step1).toHaveAttribute('data-active', 'true')
  })

  it('calls onStepClick with step index when clicked', () => {
    const onStepClick = vi.fn()
    renderSidebar({ onStepClick })
    fireEvent.click(screen.getByText('Links'))
    expect(onStepClick).toHaveBeenCalledWith(2)
  })

  it('shows progress bar', () => {
    renderSidebar()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })
})
