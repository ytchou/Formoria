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

describe('UrlStep multi-URL', () => {
  it('adds rows up to 3 then hides the add button', () => {
    renderWithZhTW(<UrlStep {...defaultProps} />)
    // addLink = "新增連結" in zh-TW
    const add = screen.getByRole('button', { name: /新增連結|add another link/i })
    fireEvent.click(add)
    fireEvent.click(screen.getByRole('button', { name: /新增連結|add another link/i }))
    expect(screen.queryByRole('button', { name: /新增連結|add another link/i })).toBeNull()
    expect(screen.getAllByRole('textbox').length).toBe(3)
  })

  it('keeps a url-typed first input for e2e selectors', () => {
    renderWithZhTW(<UrlStep {...defaultProps} />)
    expect(document.querySelector('input[type="url"]')).not.toBeNull()
  })
})
