// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import enMessages from '../../../messages/en.json'
import { OwnerBenefitsSection } from './OwnerBenefitsSection'
import { useUser } from '@/lib/auth/use-user'

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

const viewerState = {
  viewer: { hasOwnedBrand: false, isAdmin: false, impersonation: null },
  viewerLoading: false,
  refreshViewer: vi.fn(async () => {}),
}

function renderWithIntl(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  )
}

describe('OwnerBenefitsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders visitor benefits and submit CTA when unauthenticated', () => {
    vi.mocked(useUser).mockReturnValue({
      user: null,
      loading: false,
      ...viewerState,
    })

    renderWithIntl(<OwnerBenefitsSection />)

    expect(screen.getByText('Claim Your Brand')).toBeInTheDocument()
    expect(screen.getByText('Manage Your Listing')).toBeInTheDocument()
    expect(screen.getByText('Track Performance')).toBeInTheDocument()

    const cta = screen.getByRole('link', { name: 'Submit Your Brand' })
    expect(cta).toBeInTheDocument()
    expect(cta).toHaveAttribute('href', '/submit')
  })

  it('renders owner benefits when authenticated', () => {
    vi.mocked(useUser).mockReturnValue({
      user: { id: 'user-123', email: 'owner@example.com' } as ReturnType<typeof useUser>['user'],
      loading: false,
      ...viewerState,
    })

    renderWithIntl(<OwnerBenefitsSection />)

    expect(screen.getByText('Claim Your Brand')).toBeInTheDocument()
    expect(screen.getByText('Manage Your Listing')).toBeInTheDocument()
    expect(screen.getByText('Track Performance')).toBeInTheDocument()
  })
})
