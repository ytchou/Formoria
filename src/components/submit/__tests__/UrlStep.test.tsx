// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import zhMessages from '../../../../messages/zh-TW.json'
import { UrlStep } from '../UrlStep'

const defaultProps = {
  onSuccess: vi.fn(),
  onSkip: vi.fn(),
  isOwner: false,
  onOwnerChange: vi.fn(),
  onAttributionChange: vi.fn(),
}

function renderWithZhTW(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('UrlStep purchase links', () => {
  it('renders one purchase link platform select by default', () => {
    renderWithZhTW(<UrlStep {...defaultProps} />)
    // The native <select role="combobox"> is the platform select
    // There is one per purchase link row
    const selects = document.querySelectorAll('select[role="combobox"]')
    expect(selects.length).toBe(1)
  })

  it('adds a purchase link row when clicking the add button', () => {
    renderWithZhTW(<UrlStep {...defaultProps} />)
    const addButton = screen.getByRole('button', { name: /新增購買連結/i })
    fireEvent.click(addButton)
    const selects = document.querySelectorAll('select[role="combobox"]')
    expect(selects.length).toBe(2)
  })

  it('keeps a url-typed first input for e2e selectors', () => {
    renderWithZhTW(<UrlStep {...defaultProps} />)
    expect(document.querySelector('input[type="url"]')).not.toBeNull()
  })
})
