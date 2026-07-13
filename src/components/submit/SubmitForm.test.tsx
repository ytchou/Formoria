// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/app/[locale]/submit/actions', () => ({
  submitRecommendation: vi.fn(),
  submitOwnerBrand: vi.fn(),
  suggestCleanName: vi.fn(),
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

function renderForm(variant: 'recommend' | 'owner') {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={messages}>
      <SubmitForm variant={variant} />
    </NextIntlClientProvider>,
  )
}

describe('SubmitForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders recommendation form for guest users', () => {
    renderForm('recommend')
    expect(
      screen.getByRole('heading', { name: /推薦品牌/ }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/你的電子郵件/)).toBeInTheDocument()
    expect(screen.getByLabelText(/你如何知道這個品牌/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/品牌主圖/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Instagram/)).not.toBeInTheDocument()
  })

  it('renders owner form with brand links and no source attribution selector', () => {
    renderForm('owner')
    expect(
      screen.getByRole('heading', { name: /品牌主提交/ }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/品牌簡介/)).toBeRequired()
    expect(screen.getByLabelText(/品牌主圖/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Instagram/)).toBeInTheDocument()
    expect(screen.getByLabelText(/品牌所在縣市/)).toBeInTheDocument()
    expect(screen.getByText('品牌連結')).toBeInTheDocument()
    expect(screen.getByText('MIT 微笑標章編號')).toBeInTheDocument()
    expect(
      screen.queryByLabelText(/你如何知道這個品牌/),
    ).not.toBeInTheDocument()
  })

  it('renders submit button disabled before required fields are completed', () => {
    renderForm('recommend')
    expect(screen.getByRole('button', { name: /送出推薦/ })).toBeDisabled()
  })

  it('toggles the consent checkbox when its label text is clicked', async () => {
    const user = userEvent.setup()
    renderForm('recommend')
    const consent = screen.getByRole('checkbox')
    const consentText = screen.getByText(/同意/, { selector: 'span' })
    expect(consent).not.toBeChecked()
    expect(consentText).toHaveClass('font-normal')
    // Click the consent text span (bubbles to wrapping label, activating the checkbox)
    await user.click(consentText)
    expect(consent).toBeChecked()
  })
})
