// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/admin'),
}))

import { AdminNav } from '../admin-nav'

describe('AdminNav', () => {
  it('renders all navigation links', () => {
    render(<AdminNav />)
    expect(screen.getByText('管理後台', { selector: 'a' })).toBeDefined()
    expect(screen.getByText('待審核提交')).toBeDefined()
    expect(screen.getByText('品牌')).toBeDefined()
    expect(screen.getByText('分類管理')).toBeDefined()
  })

  it('renders Admin wordmark', () => {
    render(<AdminNav />)
    expect(screen.getByText('管理後台', { selector: 'span' })).toBeDefined()
  })

  it('highlights active link based on pathname', async () => {
    const { usePathname } = vi.mocked(await import('next/navigation'))
    usePathname.mockReturnValue('/admin/submissions')

    render(<AdminNav />)
    const submissionsLink = screen.getByText('待審核提交').closest('a')
    expect(submissionsLink?.className).toContain('border-b')
  })

  it('links to correct paths', () => {
    render(<AdminNav />)
    expect(screen.getByText('管理後台', { selector: 'a' }).getAttribute('href')).toBe('/admin')
    expect(screen.getByText('待審核提交').closest('a')?.getAttribute('href')).toBe('/admin/submissions')
    expect(screen.getByText('品牌').closest('a')?.getAttribute('href')).toBe('/admin/brands')
    expect(screen.getByText('分類管理').closest('a')?.getAttribute('href')).toBe('/admin/taxonomy')
  })

  it('renders the 品牌編輯審核 tab with link to /admin/pending-edits', () => {
    render(<AdminNav />)
    const link = screen.getByRole('link', { name: /品牌編輯審核/ })
    expect(link).toHaveAttribute('href', '/admin/pending-edits')
  })
})
