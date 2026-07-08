// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
  it('renders the server-provided remaining minutes on first paint', () => {
    render(
      <ImpersonationBanner
        brandName="Warmwood Living"
        expiresAt={1_783_478_713}
        initialMinutesLeft={1}
        labels={{
          banner: 'You are viewing as Warmwood Living',
          exit: 'Exit',
          timeRemaining: '{minutes}m remaining',
        }}
      />,
    )

    expect(screen.getByText('1m remaining')).toBeInTheDocument()
  })
})
