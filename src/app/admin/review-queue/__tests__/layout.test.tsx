// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/admin/review-queue/submissions'),
}))

vi.mock('@/components/admin/admin-sub-nav', () => ({
  AdminSubNav: ({ tabs }: { tabs: Array<{ label: string; href: string }> }) => (
    <nav data-testid="sub-nav">
      {tabs.map((t) => (
        <a key={t.href} href={t.href}>
          {t.label}
        </a>
      ))}
    </nav>
  ),
}))

vi.mock('@/lib/services/submissions', () => ({
  getSubmissions: vi.fn(async () => [{ id: 'submission-1' }]),
}))

vi.mock('@/lib/services/moderation', () => ({
  getFlaggedContent: vi.fn(async () => ({
    items: [{ id: 'flag-1' }, { id: 'flag-2' }],
    nextCursor: null,
  })),
}))

vi.mock('@/lib/services/pending-edits', () => ({
  getPendingEdits: vi.fn(async () => [{ id: 'edit-1' }]),
}))

describe('ReviewQueueLayout', () => {
  it('renders AdminSubNav with correct tabs and children', async () => {
    const { default: Layout } = await import('../layout')
    render(await Layout({ children: <div data-testid="child">content</div> }))
    expect(screen.getByTestId('sub-nav')).toBeInTheDocument()
    expect(screen.getByText('待審核提交')).toBeInTheDocument()
    expect(screen.getByText('內容審核')).toBeInTheDocument()
    expect(screen.getByText('品牌編輯審核')).toBeInTheDocument()
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })
})
