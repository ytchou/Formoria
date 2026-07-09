// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImpersonationBanner } from './impersonation-banner'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}))

vi.mock('@/lib/actions/impersonation', () => ({
  endImpersonationAction: vi.fn(),
}))

describe('ImpersonationBanner', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the remaining minutes on first paint', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-08T00:00:00Z'))

    render(
      <ImpersonationBanner
        brandName="Warmwood Living"
        expiresAt={Math.floor(Date.now() / 1000) + 60}
        labels={{
          banner: 'You are viewing as Warmwood Living',
          exit: 'Exit',
          timeRemaining: '{minutes}m remaining',
        }}
      />,
    )

    expect(screen.getByText('0m remaining')).toBeInTheDocument()
  })
})
