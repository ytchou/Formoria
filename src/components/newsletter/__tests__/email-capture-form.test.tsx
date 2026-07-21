// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmailCaptureForm } from '../email-capture-form'
import { trackNewsletterSubscribed } from '@/lib/analytics'

vi.mock('@/lib/analytics', () => ({
  trackNewsletterSubscribed: vi.fn(),
}))

vi.mock('@/app/actions/newsletter', () => ({
  subscribeToNewsletter: vi.fn(),
}))

const dispatchNewsletterAction = vi.hoisted(() => vi.fn())
let mockActionState: Record<string, unknown> = {}

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useActionState: vi.fn((_action: unknown, _initialState: unknown) => [
      mockActionState,
      dispatchNewsletterAction,
      false,
    ]),
  }
})

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign(
    (key: string) => key,
    { rich: (key: string) => key },
  ),
  useLocale: () => 'zh-TW',
}))

describe('EmailCaptureForm', () => {
  beforeEach(() => {
    mockActionState = {}
    vi.mocked(trackNewsletterSubscribed).mockClear()
    dispatchNewsletterAction.mockClear()
  })

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

  it('calls trackNewsletterSubscribed when subscription succeeds', async () => {
    mockActionState = { success: true }
    render(<EmailCaptureForm />)

    await waitFor(() => {
      expect(trackNewsletterSubscribed).toHaveBeenCalledWith(
        ['curated-picks'],
        true,
      )
    })
  })
})
