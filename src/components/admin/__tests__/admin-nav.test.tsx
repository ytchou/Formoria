// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { NavItem } from '../admin-nav'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/admin'),
}))

const items: NavItem[] = [
  { label: '總覽', href: '/admin' },
  {
    label: '審核佇列',
    href: '/admin/review-queue',
    children: [
      { label: '待審核提交', href: '/admin/review-queue/submissions', count: 3 },
      { label: '內容審核', href: '/admin/review-queue/moderation', count: 0 },
      { label: '品牌編輯審核', href: '/admin/review-queue/edits', count: 1 },
    ],
  },
  { label: '認領申請', href: '/admin/claims' },
  {
    label: '信號',
    href: '/admin/signals',
    children: [
      { label: '檢舉', href: '/admin/signals/reports', count: 2 },
      { label: 'Feedback', href: '/admin/signals/feedback', count: 0 },
    ],
  },
  { label: '批量匯入', href: '/admin/import' },
  {
    label: '目錄管理',
    href: '/admin/catalog',
    children: [
      { label: '品牌', href: '/admin/catalog/brands' },
      { label: '分類管理', href: '/admin/catalog/taxonomy' },
    ],
  },
]

async function renderAdminNav() {
  const { AdminNav } = await import('../admin-nav')
  render(<AdminNav items={items} />)
}

describe('AdminNav', () => {
  it('renders 6 top-level navigation links', async () => {
    await renderAdminNav()
    expect(screen.getAllByRole('link')).toHaveLength(6)
  })

  it('does not show dropdown children by default', async () => {
    await renderAdminNav()
    expect(screen.queryByText('待審核提交')).not.toBeInTheDocument()
    expect(screen.queryByText('檢舉')).not.toBeInTheDocument()
  })

  it('shows dropdown children on hover', async () => {
    await renderAdminNav()
    const trigger = screen.getByRole('link', { name: /審核佇列/ })
    await userEvent.hover(trigger.parentElement!)
    expect(screen.getByText('待審核提交')).toBeInTheDocument()
    expect(screen.getByText('內容審核')).toBeInTheDocument()
    expect(screen.getByText('品牌編輯審核')).toBeInTheDocument()
  })

  it('shows count badges for items with count > 0', async () => {
    await renderAdminNav()
    const trigger = screen.getByRole('link', { name: /審核佇列/ })
    await userEvent.hover(trigger.parentElement!)
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })
})
