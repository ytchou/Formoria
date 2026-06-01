// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { UrlStep } from '../UrlStep'

const defaultProps = {
  onSuccess: vi.fn(),
  onSkip: vi.fn(),
  isOwner: false,
  onOwnerChange: vi.fn(),
  onAttributionChange: vi.fn(),
}

describe('UrlStep multi-URL', () => {
  it('adds rows up to 3 then hides the add button', () => {
    render(<UrlStep {...defaultProps} />)
    const add = screen.getByRole('button', { name: /add another link|新增/i })
    fireEvent.click(add)
    fireEvent.click(screen.getByRole('button', { name: /add another link|新增/i }))
    expect(screen.queryByRole('button', { name: /add another link|新增/i })).toBeNull()
    expect(screen.getAllByRole('textbox').length).toBe(3)
  })

  it('keeps a url-typed first input for e2e selectors', () => {
    render(<UrlStep {...defaultProps} />)
    expect(document.querySelector('input[type="url"]')).not.toBeNull()
  })
})
