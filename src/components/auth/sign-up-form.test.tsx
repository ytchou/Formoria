// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SignUpForm } from './sign-up-form'

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => ({
    get: vi.fn(() => null),
  })),
}))

vi.mock('@/app/auth/actions', () => ({
  signUp: vi.fn(),
}))

describe('SignUpForm', () => {
  it('shows claim banner when claimToken is provided', () => {
    render(
      <SignUpForm claimToken="test-token" claimBrandName="Dachun Soap" />
    )
    expect(
      screen.getByText(/invited to claim/i)
    ).toBeInTheDocument()
    expect(screen.getByText(/Dachun Soap/i)).toBeInTheDocument()
  })

  it('does not show claim banner without claimToken', () => {
    render(<SignUpForm />)
    expect(
      screen.queryByText(/invited to claim/i)
    ).not.toBeInTheDocument()
  })

  it('includes claim token as hidden input', () => {
    const { container } = render(
      <SignUpForm claimToken="test-token" claimBrandName="Dachun Soap" />
    )
    const hidden = container.querySelector('input[name="claimToken"]')
    expect(hidden).toBeInTheDocument()
    expect(hidden).toHaveAttribute('value', 'test-token')
  })

  it('shows link to sign-in with claim param preserved', () => {
    render(
      <SignUpForm claimToken="test-token" claimBrandName="Dachun Soap" />
    )
    const signInLink = screen.getByRole('link', { name: /sign in/i })
    expect(signInLink).toHaveAttribute(
      'href',
      expect.stringContaining('claim=test-token')
    )
  })
})
