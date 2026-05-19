// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TagManager } from '../tag-manager'

vi.mock('@/app/admin/actions', () => ({
  createTagAction: vi.fn(() => Promise.resolve(undefined)),
  renameTagAction: vi.fn(() => Promise.resolve(undefined)),
  mergeTagAction: vi.fn(() => Promise.resolve(undefined)),
  deactivateTagAction: vi.fn(() => Promise.resolve(undefined)),
}))

const mockTags = [
  { id: 'tag-1', name: 'Ceramics', nameZh: '陶瓷', slug: 'ceramics', category: 'material' as const, isActive: true, suggestedBy: null, createdAt: '2026-05-01T00:00:00Z' },
  { id: 'tag-2', name: 'Wood', nameZh: '木材', slug: 'wood', category: 'material' as const, isActive: true, suggestedBy: null, createdAt: '2026-05-01T00:00:00Z' },
  { id: 'tag-3', name: 'Taipei', nameZh: '台北', slug: 'taipei', category: 'region' as const, isActive: true, suggestedBy: null, createdAt: '2026-05-01T00:00:00Z' },
  { id: 'tag-4', name: 'Handcraft', nameZh: null, slug: 'handcraft', category: 'product_type' as const, isActive: true, suggestedBy: 'sub-1', createdAt: '2026-05-15T00:00:00Z' },
  { id: 'tag-5', name: 'Old Tag', nameZh: null, slug: 'old-tag', category: 'material' as const, isActive: false, suggestedBy: null, createdAt: '2026-04-01T00:00:00Z' },
]

describe('TagManager', () => {
  it('renders tags grouped by category', () => {
    render(<TagManager tags={mockTags} />)
    // Use getAllByText since category names appear in both card headers and select
    expect(screen.getAllByText('material').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('region').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('product_type').length).toBeGreaterThanOrEqual(1)
  })

  it('renders tag names', () => {
    render(<TagManager tags={mockTags} />)
    expect(screen.getByText('Ceramics')).toBeDefined()
    expect(screen.getByText('Wood')).toBeDefined()
    expect(screen.getByText('Taipei')).toBeDefined()
  })

  it('renders Chinese names when present', () => {
    render(<TagManager tags={mockTags} />)
    expect(screen.getByText('陶瓷')).toBeDefined()
  })

  it('renders add tag form', () => {
    render(<TagManager tags={mockTags} />)
    expect(screen.getByPlaceholderText(/tag name \(english\)/i)).toBeDefined()
  })

  it('renders suggested tags section for tags with suggestedBy', () => {
    render(<TagManager tags={mockTags} />)
    // Handcraft appears in both suggested section and category section
    expect(screen.getAllByText('Handcraft').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/Suggested Tags/)).toBeDefined()
  })

  it('shows inactive tags with visual distinction', () => {
    render(<TagManager tags={mockTags} />)
    expect(screen.getByText('Old Tag')).toBeDefined()
  })

  it('submits new tag form', async () => {
    render(<TagManager tags={mockTags} />)
    const nameInput = screen.getByPlaceholderText(/tag name \(english\)/i)
    fireEvent.change(nameInput, { target: { value: 'New Tag' } })

    const addButton = screen.getByRole('button', { name: /add tag/i })
    fireEvent.click(addButton)

    const { createTagAction } = await import('@/app/admin/actions')
    expect(createTagAction).toHaveBeenCalled()
  })
})
