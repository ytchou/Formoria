// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/app/[locale]/submit/actions', () => ({
  inspectRecommendationName: vi.fn(),
  submitRecommendation: vi.fn(),
}))

vi.mock('@/components/submit/TurnstileWidget', () => ({
  TurnstileWidget: ({ onSuccess }: { onSuccess: (token: string) => void }) => {
    onSuccess('mock-turnstile-token')
    return <div data-testid="turnstile" />
  },
}))

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('@/lib/analytics', () => ({
  trackSubmissionFormOpened: vi.fn(),
  trackSubmissionCompleted: vi.fn(),
}))

import SubmitForm from './SubmitForm'
import messages from '@/../messages/zh-TW.json'
import { inspectRecommendationName } from '@/app/[locale]/submit/actions'

function renderForm() {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={messages}>
      <SubmitForm />
    </NextIntlClientProvider>,
  )
}

describe('SubmitForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(inspectRecommendationName).mockResolvedValue({
      changed: false,
      suggestion: null,
      patterns: [],
      hasDuplicate: false,
    })
  })

  it('renders recommendation form for guest users', () => {
    renderForm()
    expect(
      screen.getByRole('heading', { name: /推薦品牌/ }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/你的電子郵件/)).toBeInTheDocument()
    expect(screen.getByLabelText(/你如何知道這個品牌/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/品牌主圖/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Instagram/)).not.toBeInTheDocument()
  })

  it('places the recommendation source before email and extra context', () => {
    renderForm()
    const source = screen.getByLabelText(/你如何知道這個品牌/)
    const email = screen.getByLabelText(/你的電子郵件/)
    const description = screen.getByLabelText(/補充說明/)

    expect(
      source.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      email.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('keeps review updates separate from newsletter consent', () => {
    renderForm()

    expect(
      screen.getByText(
        '若想收到這筆品牌推薦的審核進度，請留下電子郵件。',
      ),
    ).toBeInTheDocument()

    const marketing = screen.getByRole('checkbox', {
      name: '我同意接收 Formoria 電子報',
    })
    expect(marketing).not.toBeChecked()
    expect(
      screen.queryByText(/內容包含品牌故事、新品牌與精選趨勢/),
    ).not.toBeInTheDocument()
    expect(
      marketing.compareDocumentPosition(
        screen.getByRole('button', { name: /送出推薦/ }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('groups newsletter consent with email and marks privacy consent as required', () => {
    renderForm()

    const email = screen.getByLabelText(/你的電子郵件/)
    const marketing = screen.getByRole('checkbox', {
      name: '我同意接收 Formoria 電子報',
    })
    expect(email.parentElement).toContainElement(marketing)

    const privacyConsent = screen.getByRole('checkbox', {
      name: /隱私權政策/,
    })
    const privacyLabel = privacyConsent.closest('label')
    const requiredMarker = privacyLabel?.querySelector('[aria-hidden="true"]')
    expect(privacyConsent).toHaveAttribute('aria-required', 'true')
    expect(requiredMarker).toHaveTextContent('*')
    expect(requiredMarker).toHaveClass('text-destructive')
  })

  it('explains that extra context helps the review', () => {
    renderForm()

    expect(
      screen.getByText(
        '如果你知道品牌特色、產品或背景，可以留在這裡，幫助我們審核。',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText(
        '例如：品牌在台南設計，並與台灣在地工坊合作生產。',
      ),
    ).toBeInTheDocument()
  })

  it('checks for an existing brand when the name field loses focus', async () => {
    const user = userEvent.setup()
    vi.mocked(inspectRecommendationName).mockResolvedValue({
      changed: false,
      suggestion: null,
      patterns: [],
      hasDuplicate: true,
    })
    renderForm()

    const name = screen.getByLabelText(/品牌名稱/)
    await user.type(name, 'Existing Brand')
    await user.tab()

    expect(inspectRecommendationName).toHaveBeenCalledWith('Existing Brand')
    expect(await screen.findByText('發現相似品牌名稱')).toBeInTheDocument()

    await user.type(name, ' New')
    expect(screen.queryByText('發現相似品牌名稱')).not.toBeInTheDocument()
  })

  it('renders submit button disabled before required fields are completed', () => {
    renderForm()
    expect(screen.getByRole('button', { name: /送出推薦/ })).toBeDisabled()
  })

  it('wraps the privacy consent in a shield-badged consent panel', () => {
    renderForm()
    const privacyConsent = screen.getByRole('checkbox', { name: /隱私權政策/ })
    const consentPanel = privacyConsent.closest('[data-testid="consent-panel"]')
    expect(consentPanel).toBeInTheDocument()
    expect(consentPanel).toHaveClass('rounded-lg')
    const shieldIcon = consentPanel!.querySelector('[data-testid="consent-shield"]')
    expect(shieldIcon).toBeInTheDocument()
  })

  it('toggles the consent checkbox when its label text is clicked', async () => {
    const user = userEvent.setup()
    renderForm()
    const consent = screen.getByRole('checkbox', { name: /隱私權政策/ })
    const consentText = screen.getByText(/我同意依據/, { selector: 'span' })
    expect(consent).not.toBeChecked()
    expect(consentText).toHaveClass('font-normal')
    // Click the consent text span (bubbles to wrapping label, activating the checkbox)
    await user.click(consentText)
    expect(consent).toBeChecked()
  })
})
