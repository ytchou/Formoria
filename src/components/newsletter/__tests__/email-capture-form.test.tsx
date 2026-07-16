// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmailCaptureForm } from '../email-capture-form'

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign(
    (key: string) => key,
    { rich: (key: string) => key },
  ),
  useLocale: () => 'zh-TW',
}))

describe('EmailCaptureForm', () => {
  it('renders email input and submit button', () => {
    render(<EmailCaptureForm />)
    expect(screen.getByPlaceholderText(/email/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /subscribe/i })).toBeInTheDocument()
  })

  it('renders 4 interest chips', () => {
    const { container } = render(<EmailCaptureForm />)
    const chips = container.querySelectorAll('button[aria-pressed]')
    expect(chips.length).toBe(4)
  })

  it('pre-selects curated-picks chip', () => {
    render(<EmailCaptureForm />)
    const curatedPicksChip = screen.getByRole('button', { name: /interests\.curated-picks/i })
    expect(curatedPicksChip).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders interest label text', () => {
    render(<EmailCaptureForm />)
    expect(screen.getByText(/interestsLabel/i)).toBeInTheDocument()
  })

  it('explains consent without a redundant checkbox', () => {
    render(<EmailCaptureForm />)
    expect(screen.getByText('consentNotice')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('renders honeypot field that is visually hidden', () => {
    const { container } = render(<EmailCaptureForm />)
    const honeypot = container.querySelector('input[name="website"]')
    expect(honeypot).toBeInTheDocument()
  })

  it('toggles chip selection on click', async () => {
    const user = userEvent.setup()
    render(<EmailCaptureForm />)
    const brandStoriesChip = screen.getByRole('button', { name: /interests\.brand-stories/i })
    expect(brandStoriesChip).toHaveAttribute('aria-pressed', 'false')

    await user.click(brandStoriesChip)
    expect(brandStoriesChip).toHaveAttribute('aria-pressed', 'true')

    await user.click(brandStoriesChip)
    expect(brandStoriesChip).toHaveAttribute('aria-pressed', 'false')
  })
})
