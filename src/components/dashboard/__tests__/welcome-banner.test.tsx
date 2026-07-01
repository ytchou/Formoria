// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '@/../messages/en.json'
import { WelcomeBanner } from '../welcome-banner'

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, className }: React.ComponentProps<'a'>) => (
    <a href={href} className={className}>{children}</a>
  ),
}))

vi.mock('@/lib/actions/brand-onboarding', () => ({
  startOnboardingStepAction: vi.fn(),
}))

describe('WelcomeBanner', () => {
  it('shows persisted progress and the next explicit review step', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <WelcomeBanner
          completedCount={1}
          nextStep="products"
          slug="test-brand"
          steps={[
            { key: 'basics', status: 'complete' },
            { key: 'products', status: 'not_started' },
            { key: 'story_media', status: 'not_started' },
            { key: 'purchase', status: 'not_started' },
            { key: 'social_proof', status: 'not_started' },
          ]}
        />
      </NextIntlClientProvider>
    )

    expect(screen.getByText('1 of 5 reviewed')).toBeInTheDocument()
    expect(screen.getByText('Confirm products')).toBeInTheDocument()
    expect(screen.getByText('Review story and visuals')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
    expect(screen.getByRole('link', { name: 'View checklist' })).toHaveAttribute(
      'href',
      '/dashboard/onboarding?brand=test-brand'
    )
  })

  it('renders at 100% when all steps are completed', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <WelcomeBanner
          completedCount={5}
          nextStep={null}
          slug="test-brand"
          steps={[
            { key: 'basics', status: 'complete' },
            { key: 'products', status: 'complete' },
            { key: 'story_media', status: 'complete' },
            { key: 'purchase', status: 'complete' },
            { key: 'social_proof', status: 'complete' },
          ]}
        />
      </NextIntlClientProvider>
    )

    expect(screen.getByText('5 of 5 reviewed')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5')
  })
})
