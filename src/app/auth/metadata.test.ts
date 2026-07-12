import { describe, expect, it, vi } from 'vitest'

vi.mock('jose', () => ({ decodeJwt: vi.fn() }))
vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(async () => 'en'),
  getTranslations: vi.fn(async () => (key: string) => key),
}))
vi.mock('@/lib/auth/redirect-if-authenticated', () => ({
  redirectIfAuthenticated: vi.fn(),
}))
vi.mock('@/components/auth/sign-in-form', () => ({ SignInForm: () => null }))
vi.mock('@/components/auth/sign-up-form', () => ({ SignUpForm: () => null }))
vi.mock('@/components/auth/forgot-password-form', () => ({
  ForgotPasswordForm: () => null,
}))
vi.mock('@/components/auth/reset-password-form', () => ({
  ResetPasswordForm: () => null,
}))

import { generateMetadata as forgotPasswordMetadata } from './forgot-password/page'
import { generateMetadata as resetPasswordMetadata } from './reset-password/page'
import { generateMetadata as signInMetadata } from './sign-in/page'
import { generateMetadata as signUpMetadata } from './sign-up/page'

describe('auth page metadata', () => {
  it('marks every auth page as noindex while allowing link following', async () => {
    const metadata = await Promise.all([
      signInMetadata(),
      signUpMetadata(),
      forgotPasswordMetadata(),
      resetPasswordMetadata(),
    ])

    for (const pageMetadata of metadata) {
      expect(pageMetadata.robots).toEqual({ index: false, follow: true })
    }
  })
})
