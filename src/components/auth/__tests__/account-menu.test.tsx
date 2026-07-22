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
  usePathname: () => '/brands/test',
}))
vi.mock('@/lib/auth/use-user', () => ({ useUser: vi.fn() }))
vi.mock('@/app/auth/actions', () => ({ signOut: vi.fn() }))
vi.mock('@/app/actions/locale-preference', () => ({ setLocalePreference: vi.fn() }))

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
    expect(link).toHaveAttribute('href', '/auth/sign-in?next=%2Fen%2Fbrands%2Ftest')
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

  it('shows Sign out when logged in', async () => {
    const user = userEvent.setup()

    ;(useUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: { id: 'u1', email: 'patrick@example.com' },
      loading: false,
    })
    renderWithIntl(<AccountMenu />)

    await user.click(screen.getByRole('button', { name: 'Account' }))

    expect((await screen.findAllByText('Sign out'))[0]).toBeInTheDocument()
  })

  it('shows language preferences inside the signed-in account menu', async () => {
    const user = userEvent.setup()
    ;(useUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: { id: 'u1', email: 'patrick@example.com' },
      loading: false,
    })
    renderWithIntl(<AccountMenu />)

    await user.click(screen.getByRole('button', { name: 'Account' }))

    expect((await screen.findAllByRole('menuitem', { name: 'Traditional Chinese' })).length).toBeGreaterThan(0)
    expect((await screen.findAllByRole('menuitem', { name: 'English' })).length).toBeGreaterThan(0)
  })

  it('shows account links when logged in', async () => {
    const user = userEvent.setup()

    ;(useUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: { id: 'u1', email: 'patrick@example.com' },
      loading: false,
    })
    renderWithIntl(<AccountMenu />)

    await user.click(screen.getByRole('button', { name: 'Account' }))

    await screen.findAllByText('Saved Brands')
    await screen.findAllByText('My Contributions')
    await screen.findAllByText('My Submissions')
    const favoritesLink = Array.from(document.querySelectorAll('a')).find((a) =>
      a.textContent?.includes('Saved Brands'),
    )
    const contributionsLink = Array.from(document.querySelectorAll('a')).find((a) =>
      a.textContent?.includes('My Contributions'),
    )
    const submissionsLink = Array.from(document.querySelectorAll('a')).find((a) =>
      a.textContent?.includes('My Submissions'),
    )
    expect(favoritesLink).toHaveAttribute('href', '/favorites')
    expect(contributionsLink).toHaveAttribute('href', '/contributions')
    expect(submissionsLink).toHaveAttribute('href', '/my-submissions')
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
