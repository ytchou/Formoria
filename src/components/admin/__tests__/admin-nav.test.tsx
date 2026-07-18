// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NavItem } from '../admin-nav'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/admin'),
}))

const items: NavItem[] = [
  { label: 'Overview', href: '/admin' },
  { label: 'Brand Submissions', href: '/admin/submissions', count: 3 },
  { label: 'Data Jobs', href: '/admin/jobs' },
  { label: 'Content Moderation', href: '/admin/moderation', count: 0 },
  { label: 'Brand Edits', href: '/admin/edits', count: 1 },
  { label: 'Claim Requests', href: '/admin/claims' },
  { label: 'Reports', href: '/admin/reports', count: 2 },
  { label: 'Brand Catalog', href: '/admin/brands' },
  { label: 'Quality Dashboard', href: '/admin/quality' },
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
    expect(screen.getByRole('link', { name: /Brand Submissions/ })).toHaveAttribute(
      'href',
      '/admin/submissions',
    )
    expect(screen.getByRole('link', { name: /Reports/ })).toHaveAttribute(
      'href',
      '/admin/reports',
    )
  })

  it('shows count badges for items with count > 0', async () => {
    await renderAdminNav()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
