// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WelcomeBanner } from '../welcome-banner'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

describe('WelcomeBanner', () => {
  it('renders 4 tip links', () => {
    render(<WelcomeBanner brandSlug="test-brand" dismissAction={vi.fn()} />)
    expect(screen.getByText('tips.editProfile')).toBeInTheDocument()
    expect(screen.getByText('tips.checkHealth')).toBeInTheDocument()
    expect(screen.getByText('tips.viewAnalytics')).toBeInTheDocument()
    expect(screen.getByText('tips.readFaq')).toBeInTheDocument()
  })

  it('renders a dismiss button', () => {
    render(<WelcomeBanner brandSlug="test-brand" dismissAction={vi.fn()} />)
    expect(
      screen.getByRole('button', { name: /dismiss/i }),
    ).toBeInTheDocument()
  })

  it('calls dismissAction when dismiss is clicked', async () => {
    const dismissAction = vi.fn(() => Promise.resolve())
    render(
      <WelcomeBanner brandSlug="test-brand" dismissAction={dismissAction} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(dismissAction).toHaveBeenCalledOnce()
  })

  it('links to correct dashboard routes', () => {
    render(<WelcomeBanner brandSlug="test-brand" dismissAction={vi.fn()} />)
    expect(screen.getByText('tips.editProfile').closest('a')).toHaveAttribute(
      'href',
      '/dashboard/brands/test-brand/edit',
    )
    expect(screen.getByText('tips.viewAnalytics').closest('a')).toHaveAttribute(
      'href',
      '/dashboard/brands/test-brand/analytics',
    )
  })
})
