// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/admin/catalog/brands'),
}))

vi.mock('@/components/admin/admin-sub-nav', () => ({
  AdminSubNav: ({ tabs }: { tabs: Array<{ label: string; href: string }> }) => (
    <nav data-testid="sub-nav">
      {tabs.map((t) => (
        <a key={t.href} href={t.href}>{t.label}</a>
      ))}
    </nav>
  ),
}))

describe('CatalogLayout', () => {
  it('renders AdminSubNav with Brands, Taxonomy, Import tabs', async () => {
    const { default: Layout } = await import('../layout')
    render(await Layout({ children: <div>content</div> }))
    expect(screen.getByText('品牌')).toBeInTheDocument()
    expect(screen.getByText('分類管理')).toBeInTheDocument()
    expect(screen.getByText('批量匯入')).toBeInTheDocument()
  })
})
