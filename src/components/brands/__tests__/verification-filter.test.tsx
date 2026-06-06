// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VerificationFilter } from '../verification-filter'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ replace: vi.fn() })),
  usePathname: vi.fn(() => '/brands'),
  useSearchParams: vi.fn(() => new URLSearchParams('search=tea')),
}))

describe('VerificationFilter', () => {
  it('renders all toggles as button[data-active]', () => {
    const { container } = render(<VerificationFilter active="all" />)

    expect(container.querySelectorAll('button[data-active]')).toHaveLength(3)
    expect(screen.getByRole('button', { name: /全部\s*All/i })).toHaveAttribute('data-active', 'true')
    expect(screen.getByRole('button', { name: /已驗證\s*Verified/i })).toHaveAttribute('data-active', 'false')
    expect(screen.getByRole('button', { name: /社群\s*Community/i })).toHaveAttribute('data-active', 'false')
  })

  it('reflects the active prop for the community toggle', () => {
    render(<VerificationFilter active="community" />)

    expect(screen.getByRole('button', { name: /全部\s*All/i })).toHaveAttribute('data-active', 'false')
    expect(screen.getByRole('button', { name: /社群\s*Community/i })).toHaveAttribute('data-active', 'true')
  })
})
