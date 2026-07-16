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
})
