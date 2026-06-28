// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// Mock server actions
vi.mock('@/app/[locale]/submit/actions', () => ({
  submitBrand: vi.fn(),
  suggestCleanName: vi.fn(),
}))

// Mock TurnstileWidget — immediately fires onSuccess so turnstileToken is populated
vi.mock('@/components/submit/TurnstileWidget', () => ({
  TurnstileWidget: ({ onSuccess }: { onSuccess: (token: string) => void }) => {
    onSuccess('mock-turnstile-token')
    return <div data-testid="turnstile" />
  },
}))

// Mock next-intl/navigation
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

// Mock analytics (functions may change signatures)
vi.mock('@/lib/analytics', () => ({
  trackSubmissionFormOpened: vi.fn(),
  trackSubmissionCompleted: vi.fn(),
}))

import SubmitForm from './SubmitForm'
import messages from '@/../messages/zh-TW.json'

function renderForm() {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={messages}>
      <SubmitForm />
    </NextIntlClientProvider>
  )
}

describe('SubmitForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders page heading', () => {
    renderForm()
    expect(screen.getByRole('heading', { name: /提交品牌/ })).toBeInTheDocument()
  })

  it('renders website field', () => {
    renderForm()
    expect(screen.getByLabelText(/品牌官方網站/)).toBeInTheDocument()
  })

  it('renders brand name field', () => {
    renderForm()
    expect(screen.getByLabelText(/品牌名稱/)).toBeInTheDocument()
  })

  it('renders ownership checkbox', () => {
    renderForm()
    expect(screen.getByLabelText(/我是品牌負責人/)).toBeInTheDocument()
  })

  it('ownership checkbox is unchecked by default', () => {
    renderForm()
    const ownerCheckbox = screen.getByLabelText(/我是品牌負責人/)
    expect(ownerCheckbox).not.toBeChecked()
  })

  it('renders social links section', () => {
    renderForm()
    // Social links are always visible (no accordion) — verify the section label exists
    expect(screen.getByText(/其他連結/)).toBeInTheDocument()
  })

  it('renders submit button', () => {
    renderForm()
    expect(screen.getByRole('button', { name: /提交品牌/ })).toBeInTheDocument()
  })

  it('renders submit button initially disabled (form not yet valid)', () => {
    renderForm()
    // Button should be disabled because pdpaConsent = false (and fields empty)
    const submitBtn = screen.getByRole('button', { name: /提交品牌/ })
    expect(submitBtn).toBeDisabled()
  })

  it('shows source attribution when ownership unchecked', () => {
    renderForm()
    // isOwner defaults to false (unchecked), so source attribution is already visible
    expect(screen.getByLabelText(/資料來源/)).toBeVisible()
  })

  it('always renders source attribution regardless of ownership', () => {
    renderForm()
    // Source attribution is always visible (not conditional on isOwner)
    expect(screen.getByLabelText(/資料來源/)).toBeInTheDocument()
  })

  it('renders social link fields directly without accordion interaction', () => {
    renderForm()
    // Social links are always expanded (accordion removed) — fields are immediately accessible
    expect(screen.getByLabelText(/Instagram/)).toBeInTheDocument()
  })

  it('renders hidden honeypot field', () => {
    renderForm()
    const honeypot = document.querySelector('input[name="honeypot"]')
    expect(honeypot).toBeInTheDocument()
    expect(honeypot).toHaveAttribute('tabindex', '-1')
    expect(honeypot).toHaveAttribute('aria-hidden', 'true')
  })
})
