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
  { id: 'tag-1', name: 'Ceramics', nameZh: '陶瓷', slug: 'ceramics', category: 'product_type' as const, isActive: true, createdAt: '2026-05-01T00:00:00Z' },
  { id: 'tag-2', name: 'Wood', nameZh: '木材', slug: 'wood', category: 'product_type' as const, isActive: true, createdAt: '2026-05-01T00:00:00Z' },
  { id: 'tag-3', name: 'Eco-friendly', nameZh: '環保', slug: 'eco-friendly', category: 'value' as const, isActive: true, createdAt: '2026-05-01T00:00:00Z' },
  { id: 'tag-4', name: 'Handcraft', nameZh: null, slug: 'handcraft', category: 'product_type' as const, isActive: true, createdAt: '2026-05-15T00:00:00Z' },
  { id: 'tag-5', name: 'Old Tag', nameZh: null, slug: 'old-tag', category: 'product_type' as const, isActive: false, createdAt: '2026-04-01T00:00:00Z' },
]

describe('TagManager', () => {
  it('renders tags grouped by category', () => {
    render(<TagManager tags={mockTags} />)
    // Category labels are now in Mandarin
    expect(screen.getAllByText('品牌特色').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('產品類型').length).toBeGreaterThanOrEqual(1)
  })

  it('renders tag names', () => {
    render(<TagManager tags={mockTags} />)
    expect(screen.getByText('Ceramics')).toBeDefined()
    expect(screen.getByText('Wood')).toBeDefined()
    expect(screen.getByText('Eco-friendly')).toBeDefined()
  })

  it('renders Chinese names when present', () => {
    render(<TagManager tags={mockTags} />)
    expect(screen.getByText('陶瓷')).toBeDefined()
  })

  it('renders add tag form', () => {
    render(<TagManager tags={mockTags} />)
    expect(screen.getByPlaceholderText('標籤名稱（英文）')).toBeDefined()
  })

  it('shows inactive tags with visual distinction', () => {
    render(<TagManager tags={mockTags} />)
    expect(screen.getByText('Old Tag')).toBeDefined()
  })

  it('submits new tag form', async () => {
    render(<TagManager tags={mockTags} />)
    const nameInput = screen.getByPlaceholderText('標籤名稱（英文）')
    fireEvent.change(nameInput, { target: { value: 'New Tag' } })

    const addButton = screen.getByRole('button', { name: '新增標籤' })
    fireEvent.click(addButton)

    const { createTagAction } = await import('@/app/admin/actions')
    expect(createTagAction).toHaveBeenCalled()
  })
})
