// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, it, expect, vi } from 'vitest'

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

import SubmitForm from '../SubmitForm'
import messages from '@/../messages/zh-TW.json'

function renderForm() {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={messages}>
      <SubmitForm variant="owner" />
    </NextIntlClientProvider>
  )
}

describe('SubmitForm city field', () => {
  it('renders the city select with Taiwan city options', () => {
    renderForm()

    const citySelect = screen.getByLabelText(/品牌所在縣市/)
    expect(citySelect).toBeInTheDocument()
    expect(citySelect).toHaveAttribute('id', 'submit-city')
    expect(screen.getByRole('option', { name: /請選擇縣市（選填）/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '臺北市' })).toBeInTheDocument()
  })
})
