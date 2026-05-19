// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SignInForm } from './sign-in-form'

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => ({
    get: vi.fn(() => null),
  })),
}))

vi.mock('@/app/auth/actions', () => ({
  signIn: vi.fn(),
}))

describe('SignInForm', () => {
  it('shows claim banner when claimToken is provided', () => {
    render(
      <SignInForm claimToken="test-token" claimBrandName="Dachun Soap" />
    )
    expect(
      screen.getByText(/sign in to claim/i)
    ).toBeInTheDocument()
  })

  it('includes claim token as hidden input', () => {
    const { container } = render(
      <SignInForm claimToken="test-token" claimBrandName="Dachun Soap" />
    )
    const hidden = container.querySelector('input[name="claimToken"]')
    expect(hidden).toBeInTheDocument()
  })

  it('does not show claim banner without claimToken', () => {
    render(<SignInForm />)
    expect(
      screen.queryByText(/sign in to claim/i)
    ).not.toBeInTheDocument()
  })
})
