// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NavItem } from '../admin-nav'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/admin'),
}))

const items: NavItem[] = [
  { label: '總覽', href: '/admin' },
  { label: '新品牌提交', href: '/admin/review-queue/submissions', count: 3 },
  { label: '內容審核', href: '/admin/review-queue/moderation', count: 0 },
  { label: '品牌編輯', href: '/admin/review-queue/edits', count: 1 },
  { label: '認領申請', href: '/admin/claims' },
  { label: '檢舉', href: '/admin/signals/reports', count: 2 },
  { label: 'Feedback', href: '/admin/signals/feedback', count: 0 },
  { label: '品牌目錄', href: '/admin/catalog/brands' },
  { label: '資料工作', href: '/admin/jobs' },
  { label: '品質儀表板', href: '/admin/quality' },
]

async function renderAdminNav() {
  const { AdminNav } = await import('../admin-nav')
  render(<AdminNav items={items} />)
}

describe('AdminNav', () => {
  it('renders the flattened admin navigation links', async () => {
    await renderAdminNav()
    expect(screen.getAllByRole('link')).toHaveLength(items.length)
  })

  it('shows each operational workspace without a hover-only dropdown', async () => {
    await renderAdminNav()
    expect(screen.getByRole('link', { name: /新品牌提交/ })).toHaveAttribute(
      'href',
      '/admin/review-queue/submissions',
    )
    expect(screen.getByRole('link', { name: /檢舉/ })).toHaveAttribute(
      'href',
      '/admin/signals/reports',
    )
  })

  it('shows count badges for items with count > 0', async () => {
    await renderAdminNav()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
