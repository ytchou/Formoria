// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/admin/signals/reports'),
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

vi.mock('@/lib/services/reports', () => ({
  getPendingReports: vi.fn(async () => []),
}))

vi.mock('@/lib/services/feedback', () => ({
  getFeedbackItems: vi.fn(async () => []),
}))

describe('SignalsLayout', () => {
  it('renders AdminSubNav with Reports and Feedback tabs', async () => {
    const { default: Layout } = await import('../layout')
    render(await Layout({ children: <div>content</div> }))
    expect(screen.getByText('檢舉')).toBeInTheDocument()
    expect(screen.getByText('Feedback')).toBeInTheDocument()
  })
})
