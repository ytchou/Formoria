// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import zhMessages from '../../../messages/zh-TW.json'
import { SignInForm } from './sign-in-form'

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => ({
    get: vi.fn(() => null),
  })),
}))

vi.mock('@/app/auth/actions', () => ({
  signIn: vi.fn(),
}))

function renderWithZhTW(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('SignInForm', () => {
  it('shows claim banner when claimToken is provided', () => {
    renderWithZhTW(
      <SignInForm claimToken="test-token" claimBrandName="Dachun Soap" />
    )
    // claimMessage in zh-TW: "登入以在 Formoria 認領 <strong>{brandName}</strong>。"
    expect(
      screen.getByText(/登入以在/)
    ).toBeInTheDocument()
  })

  it('includes claim token as hidden input', () => {
    const { container } = renderWithZhTW(
      <SignInForm claimToken="test-token" claimBrandName="Dachun Soap" />
    )
    const hidden = container.querySelector('input[name="claimToken"]')
    expect(hidden).toBeInTheDocument()
  })

  it('does not show claim banner without claimToken', () => {
    renderWithZhTW(<SignInForm />)
    expect(
      screen.queryByText(/登入以在/)
    ).not.toBeInTheDocument()
  })
})
