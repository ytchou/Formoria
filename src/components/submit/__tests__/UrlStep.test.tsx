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
  it('renders fixed purchase link fields (website, pinkoi, shopee) by default', () => {
    renderWithZhTW(<UrlStep {...defaultProps} />)
    // The new flat-field design has fixed inputs instead of a dynamic platform select
    expect(document.querySelector('#purchase-website')).not.toBeNull()
    expect(document.querySelector('#purchase-pinkoi')).not.toBeNull()
    expect(document.querySelector('#purchase-shopee')).not.toBeNull()
  })

  it('adds an other-url row when clicking the add link button', () => {
    renderWithZhTW(<UrlStep {...defaultProps} />)
    // "新增連結" is the add button for other/custom URLs
    const addButton = screen.getByRole('button', { name: /新增連結/i })
    const urlInputsBefore = document.querySelectorAll('input[type="url"]').length
    fireEvent.click(addButton)
    const urlInputsAfter = document.querySelectorAll('input[type="url"]').length
    expect(urlInputsAfter).toBeGreaterThan(urlInputsBefore)
  })

  it('keeps a url-typed first input for e2e selectors', () => {
    renderWithZhTW(<UrlStep {...defaultProps} />)
    expect(document.querySelector('input[type="url"]')).not.toBeNull()
  })
})
