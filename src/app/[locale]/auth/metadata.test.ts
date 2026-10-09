import { describe, expect, it, vi } from 'vitest'

vi.mock('jose', () => ({ decodeJwt: vi.fn() }))
vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(async () => 'en'),
  getTranslations: vi.fn(async () => (key: string) => key),
  setRequestLocale: vi.fn(),
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
    const props = { params: Promise.resolve({ locale: 'en' }) }
    const metadata = await Promise.all([
      signInMetadata(props),
      signUpMetadata(props),
      forgotPasswordMetadata(props),
      resetPasswordMetadata(props),
    ])

    for (const pageMetadata of metadata) {
      expect(pageMetadata.robots).toEqual({ index: false, follow: true })
    }
  })

  // CP2-35: without its own description an auth page inherited the
  // homepage's, in <meta name="description"> and in the share card.
  it.each([
    ['sign-in', signInMetadata, 'signIn.metaTitle', 'signIn.metaDescription'],
    ['sign-up', signUpMetadata, 'signUp.heading', 'signUp.metaDescription'],
    [
      'forgot-password',
      forgotPasswordMetadata,
      'forgotPassword.heading',
      'forgotPassword.metaDescription',
    ],
    [
      'reset-password',
      resetPasswordMetadata,
      'resetPassword.heading',
      'resetPassword.metaDescription',
    ],
  ] as const)(
    '%s has its own title and description, also in the share card',
    async (_name, build, title, description) => {
      const metadata = await build({ params: Promise.resolve({ locale: 'en' }) })

      expect(metadata.title).toBe(title)
      expect(metadata.description).toBe(description)
      expect(metadata.openGraph?.title).toBe(title)
      expect(metadata.openGraph?.description).toBe(description)
      expect(metadata.twitter?.description).toBe(description)
      expect(metadata.openGraph?.locale).toBe('en_US')
      expect(metadata.alternates).toEqual({ canonical: null, languages: {} })
    },
  )
})
