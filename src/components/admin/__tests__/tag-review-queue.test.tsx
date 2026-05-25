// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TagReviewQueue } from '../tag-review-queue'

const mockBrands = [
  {
    id: 'b1',
    name: 'Leather Studio',
    slug: 'leather-studio',
    tags: [{ id: 't1', name: 'Bags', nameZh: '包', slug: 'bags', category: 'product_type' as const, isActive: true, suggestedBy: null, createdAt: '2026-01-01', source: 'auto' as const }]
  }
]

describe('TagReviewQueue', () => {
  it('shows count of brands pending review', () => {
    render(<TagReviewQueue brands={mockBrands} allTags={[]} onConfirm={vi.fn()} onEdit={vi.fn()} />)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText(/pending review/i)).toBeInTheDocument()
  })

  it('shows brand name and auto-assigned tags', () => {
    render(<TagReviewQueue brands={mockBrands} allTags={[]} onConfirm={vi.fn()} onEdit={vi.fn()} />)
    expect(screen.getByText('Leather Studio')).toBeInTheDocument()
    expect(screen.getByText('Bags')).toBeInTheDocument()
  })

  it('calls onConfirm with brandId and current tagIds on confirm', () => {
    const onConfirm = vi.fn()
    render(<TagReviewQueue brands={mockBrands} allTags={[]} onConfirm={onConfirm} onEdit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(onConfirm).toHaveBeenCalledWith('b1', ['t1'])
  })

  it('calls onEdit with brand when edit is clicked', () => {
    const onEdit = vi.fn()
    render(<TagReviewQueue brands={mockBrands} allTags={[]} onConfirm={vi.fn()} onEdit={onEdit} />)
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    expect(onEdit).toHaveBeenCalledWith(mockBrands[0])
  })
})
