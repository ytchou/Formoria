// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import zhMessages from '../../../messages/zh-TW.json'
import { SignUpForm } from './sign-up-form'

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => ({
    get: vi.fn(() => null),
  })),
}))

vi.mock('@/app/auth/actions', () => ({
  signUp: vi.fn(),
}))

function renderWithZhTW(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('SignUpForm', () => {
  it('shows claim banner when claimToken is provided', () => {
    renderWithZhTW(
      <SignUpForm claimToken="test-token" claimBrandName="Dachun Soap" />
    )
    // claimMessage zh-TW: "您已受邀在 Formoria 認領 <strong>{brandName}</strong>。..."
    expect(
      screen.getByText(/您已受邀/)
    ).toBeInTheDocument()
    expect(screen.getByText(/Dachun Soap/i)).toBeInTheDocument()
  })

  it('does not show claim banner without claimToken', () => {
    renderWithZhTW(<SignUpForm />)
    expect(
      screen.queryByText(/您已受邀/)
    ).not.toBeInTheDocument()
  })

  it('includes claim token as hidden input', () => {
    const { container } = renderWithZhTW(
      <SignUpForm claimToken="test-token" claimBrandName="Dachun Soap" />
    )
    const hidden = container.querySelector('input[name="claimToken"]')
    expect(hidden).toBeInTheDocument()
    expect(hidden).toHaveAttribute('value', 'test-token')
  })

  it('shows link to sign-in with claim param preserved', () => {
    renderWithZhTW(
      <SignUpForm claimToken="test-token" claimBrandName="Dachun Soap" />
    )
    // signInLink = "登入" in zh-TW
    const signInLink = screen.getByRole('link', { name: /登入/ })
    expect(signInLink).toHaveAttribute(
      'href',
      expect.stringContaining('claim=test-token')
    )
  })
})
