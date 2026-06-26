// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
import type { TaxonomyTag } from '@/lib/types/taxonomy'

const mockRegionTags: TaxonomyTag[] = [
  {
    id: 'region-1',
    name: 'Northern Taiwan',
    nameZh: '北部',
    slug: 'northern',
    category: 'region',
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
  },
]

function renderForm(regionTags = mockRegionTags) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={messages}>
      <SubmitForm regionTags={regionTags} />
    </NextIntlClientProvider>
  )
}

describe('SubmitForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders page heading', () => {
    renderForm()
    expect(screen.getByRole('heading', { name: /提交台灣品牌/ })).toBeInTheDocument()
  })

  it('renders website field', () => {
    renderForm()
    expect(screen.getByLabelText(/品牌官方網站/)).toBeInTheDocument()
  })

  it('renders brand name field', () => {
    renderForm()
    expect(screen.getByLabelText(/品牌名稱/)).toBeInTheDocument()
  })

  it('renders region select', () => {
    renderForm()
    expect(screen.getByLabelText(/品牌所在地區/)).toBeInTheDocument()
  })

  it('renders region options from props', () => {
    renderForm()
    expect(screen.getByRole('option', { name: /北部/ })).toBeInTheDocument()
  })

  it('renders ownership checkbox', () => {
    renderForm()
    expect(screen.getByLabelText(/我是品牌負責人/)).toBeInTheDocument()
  })

  it('ownership checkbox is checked by default', () => {
    renderForm()
    const ownerCheckbox = screen.getByLabelText(/我是品牌負責人/)
    expect(ownerCheckbox).toBeChecked()
  })

  it('renders links accordion collapsed by default', () => {
    renderForm()
    const accordionButton = screen.getByRole('button', { name: /其他連結/ })
    expect(accordionButton).toBeInTheDocument()
    expect(accordionButton).toHaveAttribute('aria-expanded', 'false')
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

  it('shows source attribution when ownership unchecked', async () => {
    renderForm()
    const ownerCheckbox = screen.getByLabelText(/我是品牌負責人/)
    await userEvent.click(ownerCheckbox)
    // Source attribution select should now be visible
    expect(screen.getByLabelText(/資料來源/)).toBeVisible()
  })

  it('always renders source attribution regardless of ownership', () => {
    renderForm()
    // Source attribution is always visible (not conditional on isOwner)
    expect(screen.getByLabelText(/資料來源/)).toBeInTheDocument()
  })

  it('expands links accordion on click', async () => {
    renderForm()
    const accordionButton = screen.getByRole('button', { name: /其他連結/ })
    await userEvent.click(accordionButton)
    expect(accordionButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText(/Instagram/)).toBeInTheDocument()
  })

  it('renders hidden honeypot field', () => {
    renderForm()
    const honeypot = document.querySelector('input[name="honeypot"]')
    expect(honeypot).toBeInTheDocument()
    expect(honeypot).toHaveAttribute('tabindex', '-1')
    expect(honeypot).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders with empty regionTags', () => {
    renderForm([])
    expect(screen.getByLabelText(/品牌所在地區/)).toBeInTheDocument()
  })
})
