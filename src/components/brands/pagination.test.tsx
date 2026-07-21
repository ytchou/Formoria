// @vitest-environment jsdom

import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Pagination } from './pagination'

const mockTrackDirectoryPageNavigated = vi.fn()

vi.mock('@/lib/analytics', () => ({
  trackDirectoryPageNavigated: (...args: unknown[]) =>
    mockTrackDirectoryPageNavigated(...args),
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    scroll: _scroll,
    onClick,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    children: ReactNode
    scroll?: boolean
  }) => {
    void _scroll
    return (
      <a href={href} onClick={onClick} {...props}>
        {children}
      </a>
    )
  },
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/brands',
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('next-intl', () => ({
  useTranslations:
    () =>
    (key: string) => {
      const messages: Record<string, string> = {
        'pagination.previous': '‹ Previous',
        'pagination.previousAria': 'Previous page',
        'pagination.next': 'Next ›',
        'pagination.nextAria': 'Next page',
      }
      return messages[key] ?? key
    },
}))

describe('Pagination', () => {
  beforeEach(() => {
    mockTrackDirectoryPageNavigated.mockClear()
  })

  it('fires trackDirectoryPageNavigated with correct page, direction, and totalPages on page link click', async () => {
    const user = userEvent.setup()
    // 40 items, 10 per page = 4 total pages; current page = 2
    render(<Pagination totalCount={40} currentPage={2} pageSize={10} />)

    // Page 4 is 2 ahead of current (2) → direction 'jump'
    await user.click(screen.getByRole('link', { name: '4' }))

    expect(mockTrackDirectoryPageNavigated).toHaveBeenCalledWith(4, 'jump', 4)
  })

  it('fires trackDirectoryPageNavigated with next direction for the adjacent next page', async () => {
    const user = userEvent.setup()
    render(<Pagination totalCount={40} currentPage={2} pageSize={10} />)

    // Page 3 = currentPage + 1 → direction 'next'
    await user.click(screen.getByRole('link', { name: '3' }))

    expect(mockTrackDirectoryPageNavigated).toHaveBeenCalledWith(3, 'next', 4)
  })

  it('fires trackDirectoryPageNavigated with prev direction for the Previous nav link', async () => {
    const user = userEvent.setup()
    render(<Pagination totalCount={40} currentPage={3} pageSize={10} />)

    await user.click(screen.getByRole('link', { name: 'Previous page' }))

    expect(mockTrackDirectoryPageNavigated).toHaveBeenCalledWith(2, 'prev', 4)
  })
})
