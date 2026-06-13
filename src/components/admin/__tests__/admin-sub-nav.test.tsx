// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AdminSubNav } from '../admin-sub-nav'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/admin/review-queue/submissions'),
}))

describe('AdminSubNav', () => {
  const tabs = [
    { label: '待審核提交', href: '/admin/review-queue/submissions', count: 3 },
    { label: '內容審核', href: '/admin/review-queue/moderation', count: 1 },
    { label: '品牌編輯審核', href: '/admin/review-queue/edits', count: 0 },
  ]

  it('renders all tab labels as links', () => {
    render(<AdminSubNav tabs={tabs} />)
    expect(screen.getByRole('link', { name: /待審核提交/ })).toHaveAttribute('href', '/admin/review-queue/submissions')
    expect(screen.getByRole('link', { name: /內容審核/ })).toHaveAttribute('href', '/admin/review-queue/moderation')
    expect(screen.getByRole('link', { name: /品牌編輯審核/ })).toHaveAttribute('href', '/admin/review-queue/edits')
  })

  it('highlights the active tab based on pathname', () => {
    render(<AdminSubNav tabs={tabs} />)
    const activeLink = screen.getByRole('link', { name: /待審核提交/ })
    expect(activeLink.className).toMatch(/border-\[#E06B3F\]|border-primary|text-foreground/)
  })

  it('shows count badges when count > 0', () => {
    render(<AdminSubNav tabs={tabs} />)
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('does not show count badge when count is 0', () => {
    render(<AdminSubNav tabs={tabs} />)
    const editsLink = screen.getByRole('link', { name: /品牌編輯審核/ })
    expect(editsLink.textContent).not.toContain('0')
  })
})
