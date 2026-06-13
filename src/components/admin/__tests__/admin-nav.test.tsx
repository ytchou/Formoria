// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/admin'),
}))

async function renderAdminNav() {
  const { AdminNav } = await import('../admin-nav')
  render(<AdminNav />)
}

describe('AdminNav', () => {
  it('renders exactly 5 navigation links', async () => {
    await renderAdminNav()

    expect(screen.getAllByRole('link')).toHaveLength(5)
  })

  it('renders correct labels', async () => {
    await renderAdminNav()

    expect(screen.getByRole('link', { name: '總覽' })).toBeDefined()
    expect(screen.getByRole('link', { name: '審核佇列' })).toBeDefined()
    expect(screen.getByRole('link', { name: '認領申請' })).toBeDefined()
    expect(screen.getByRole('link', { name: '信號' })).toBeDefined()
    expect(screen.getByRole('link', { name: '目錄管理' })).toBeDefined()
  })

  it('renders correct hrefs', async () => {
    await renderAdminNav()

    expect(screen.getByRole('link', { name: '總覽' })).toHaveAttribute(
      'href',
      '/admin'
    )
    expect(screen.getByRole('link', { name: '審核佇列' })).toHaveAttribute(
      'href',
      '/admin/review-queue'
    )
    expect(screen.getByRole('link', { name: '認領申請' })).toHaveAttribute(
      'href',
      '/admin/claims'
    )
    expect(screen.getByRole('link', { name: '信號' })).toHaveAttribute(
      'href',
      '/admin/signals'
    )
    expect(screen.getByRole('link', { name: '目錄管理' })).toHaveAttribute(
      'href',
      '/admin/catalog'
    )
  })

  it('does not render old tab labels', async () => {
    await renderAdminNav()

    expect(screen.queryByRole('link', { name: '待審核提交' })).toBeNull()
    expect(screen.queryByRole('link', { name: '品牌編輯審核' })).toBeNull()
    expect(screen.queryByRole('link', { name: '內容審核' })).toBeNull()
  })
})
