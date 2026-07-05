// @vitest-environment jsdom
import type { MouseEventHandler, ReactNode } from 'react'

import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'

import enMessages from '../../../../messages/en.json'
import { MainNav } from '../main-nav'

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    className,
    onClick,
  }: {
    children: ReactNode
    href: string
    className?: string
    onClick?: MouseEventHandler<HTMLAnchorElement>
  }) => (
    <a href={href} className={className} onClick={onClick}>
      {children}
    </a>
  ),
  usePathname: () => '/',
}))

vi.mock('@/components/auth/account-menu', () => ({
  AccountMenu: () => <span role="link">Sign in</span>,
}))

vi.mock('../nav-search-input', () => ({
  NavSearchInput: () => <div data-testid="nav-search-input" />,
}))

vi.mock('../nav-category-tabs', () => ({
  NavCategoryTabs: () => <div data-testid="nav-category-tabs" />,
}))

function renderWithIntl(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  )
}

describe('MainNav', () => {
  it('renders the account entry point', () => {
    renderWithIntl(<MainNav categories={[]} />)

    expect(
      screen.getAllByRole('link', { name: 'Sign in' }).length,
    ).toBeGreaterThan(0)
  })

  it('renders the language switcher trigger', () => {
    renderWithIntl(<MainNav categories={[]} />)

    expect(
      screen.getAllByRole('button', { name: 'Switch language' }).length,
    ).toBeGreaterThan(0)
  })

  it('shows only My Brand when the account already owns a brand', () => {
    renderWithIntl(<MainNav categories={[]} hasOwnedBrand />)

    expect(screen.getByRole('link', { name: 'My Brand' })).toHaveAttribute('href', '/dashboard')
    expect(screen.queryByRole('link', { name: 'Submit a Brand' })).not.toBeInTheDocument()
  })
})
