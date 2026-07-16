// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import zhMessages from '../../../../messages/zh-TW.json'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/app/[locale]/submit/actions', () => ({
  submitOwnerQuick: vi.fn(),
  suggestCleanName: vi.fn().mockResolvedValue({ changed: false }),
}))
vi.mock('@/components/submit/TurnstileWidget', () => ({
  TurnstileWidget: ({
    onSuccess,
  }: {
    onSuccess: (token: string) => void
  }) => (
    <button data-testid="turnstile" onClick={() => onSuccess('mock-token')}>
      Turnstile
    </button>
  ),
}))

describe('SubmitQuickForm', () => {
  it('renders name, website, and description fields', async () => {
    const { default: SubmitQuickForm } = await import('../SubmitQuickForm')
    render(
      <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
        <SubmitQuickForm />
      </NextIntlClientProvider>,
    )
    expect(screen.getByLabelText(/品牌名稱/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/網站/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/簡介/i)).toBeInTheDocument()
  })

  it('does not render social links or city fields', async () => {
    const { default: SubmitQuickForm } = await import('../SubmitQuickForm')
    render(
      <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
        <SubmitQuickForm />
      </NextIntlClientProvider>,
    )
    expect(screen.queryByLabelText(/Instagram/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/城市/i)).not.toBeInTheDocument()
  })
})
