// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import zhMessages from '../../../../../../messages/zh-TW.json'

type MockLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode
  href: string
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  redirect: vi.fn(),
}))

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(),
  setRequestLocale: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'owner-123' } },
        error: null,
      }),
    },
  }),
}))

vi.mock('@/lib/services/brand-owners', () => ({
  getUserBrand: vi.fn().mockResolvedValue({ id: 'brand-123' }),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: MockLinkProps) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

describe('Owner Fork UI', () => {
  it('renders quick and full-detail cards', async () => {
    const { default: OwnerForkClient } = await import('../owner-fork-client')
    render(
      <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
        <OwnerForkClient />
      </NextIntlClientProvider>
    )
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it('redirects an existing owner to the recommendation flow', async () => {
    const { redirect } = await import('next/navigation')
    const { default: SubmitOwnerPage } = await import('../page')

    await SubmitOwnerPage({ params: Promise.resolve({ locale: 'zh-TW' }) })

    expect(redirect).toHaveBeenCalledWith('/submit/recommend')
  })
})
