// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'

import enMessages from '../../../../messages/en.json'
import { AccountMenu } from '../account-menu'

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('@/lib/auth/use-user', () => ({ useUser: vi.fn() }))
vi.mock('@/app/auth/actions', () => ({ signOut: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => '/brands/test' }))

import { useUser } from '@/lib/auth/use-user'

function renderWithIntl(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  )
}

describe('AccountMenu', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows a Sign in link that returns to the current page when logged out', () => {
    ;(useUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: null,
      loading: false,
    })
    renderWithIntl(<AccountMenu />)
    const link = screen.getByRole('link', { name: 'Sign in' })
    expect(link).toHaveAttribute('href', '/auth/sign-in?next=%2Fbrands%2Ftest')
  })

  it('shows a circular account trigger with the email initial when logged in', () => {
    (useUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: { id: 'u1', email: 'patrick@example.com' },
      loading: false,
    })
    renderWithIntl(<AccountMenu />)

    const trigger = screen.getByRole('button', { name: 'Account' })

    expect(trigger).toHaveClass(
      'size-9',
      'rounded-full',
      'bg-secondary',
      'text-secondary-foreground',
    )
    expect(trigger).toHaveTextContent('P')
    expect(trigger.querySelector('svg')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('shows Dashboard and Sign out when logged in', async () => {
    const user = userEvent.setup()

    ;(useUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: { id: 'u1', email: 'patrick@example.com' },
      loading: false,
    })
    renderWithIntl(<AccountMenu />)

    await user.click(screen.getByRole('button', { name: 'Account' }))

    expect(screen.queryByText('My Submissions')).not.toBeInTheDocument()

    // Base UI renders menu items with role="menuitem" (and duplicates them across an
    // inert layer), so query the underlying anchor/text directly.
    await screen.findAllByText('Owner Dashboard')
    const dashboardLink = Array.from(document.querySelectorAll('a')).find((a) =>
      a.textContent?.includes('Owner Dashboard'),
    )
    expect(dashboardLink).toHaveAttribute('href', '/dashboard')

    expect((await screen.findAllByText('Sign out'))[0]).toBeInTheDocument()
  })

  it('shows a Saved Brands link when logged in', async () => {
    const user = userEvent.setup()

    ;(useUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: { id: 'u1', email: 'patrick@example.com' },
      loading: false,
    })
    renderWithIntl(<AccountMenu />)

    await user.click(screen.getByRole('button', { name: 'Account' }))

    await screen.findAllByText('Saved Brands')
    const favoritesLink = Array.from(document.querySelectorAll('a')).find((a) =>
      a.textContent?.includes('Saved Brands'),
    )
    expect(favoritesLink).toHaveAttribute('href', '/favorites')
  })

  it('renders a non-interactive placeholder while loading', () => {
    ;(useUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: null,
      loading: true,
    })
    const { container } = renderWithIntl(<AccountMenu />)
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument()
    expect(
      container.querySelector('[data-account-menu-placeholder]'),
    ).toBeInTheDocument()
  })
})
