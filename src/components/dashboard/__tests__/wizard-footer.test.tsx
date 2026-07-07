// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WizardFooter } from '../wizard-footer'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/../messages/en.json'

function renderFooter(props = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <WizardFooter
        activeStep={1}
        totalSteps={9}
        isSaving={false}
        onBack={vi.fn()}
        onSaveAndContinue={vi.fn()}
        onSave={vi.fn()}
        onPublish={vi.fn()}
        {...props}
      />
    </NextIntlClientProvider>
  )
}

describe('WizardFooter', () => {
  it('shows Back and Save & Continue on non-final steps', () => {
    renderFooter({ activeStep: 1 })
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save & continue/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save & continue/i })).toHaveClass(
      'h-9',
      'rounded-lg',
      'bg-primary',
    )
  })

  it('shows Save and Publish on final step (step 8)', () => {
    renderFooter({ activeStep: 8, totalSteps: 9 })
    expect(screen.getByRole('button', { name: /save changes/i })).toHaveClass(
      'border-border',
    )
    expect(screen.getByRole('button', { name: /publish/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save & continue/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /publish/i })).toHaveClass(
      'h-9',
      'rounded-lg',
      'bg-cta',
    )
  })

  it('hides Back button on first step', () => {
    renderFooter({ activeStep: 0 })
    expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument()
  })

  it('shows disabled state when isSaving', () => {
    renderFooter({ isSaving: true })
    const btn = screen.getByRole('button', { name: /save & continue/i })
    expect(btn).toBeDisabled()
  })

  it('calls onBack when Back is clicked', () => {
    const onBack = vi.fn()
    renderFooter({ activeStep: 2, onBack })
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})
