// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { FlaggedTable } from '../flagged-table'

vi.mock('@/app/admin/actions', () => ({
  bulkUpdateFlagsAction: vi.fn().mockResolvedValue({ updated: 1, errors: [] }),
  reviewFlagAction: vi.fn().mockResolvedValue(undefined),
  revertFlagAction: vi.fn().mockResolvedValue({ success: true }),
}))

const mockFlags = [
  {
    id: 'flag-1',
    brandId: 'brand-1',
    brandName: 'Test Brand',
    brandSlug: 'test-brand',
    userId: 'user-1',
    fieldName: 'description',
    flaggedContent: 'SPAMMY CONTENT',
    previousContent: 'Clean content',
    flagReason: 'SEO spam',
    tier: 'flag',
    status: 'pending',
    reviewedAt: null,
    createdAt: '2026-05-22T00:00:00Z',
  },
  {
    id: 'flag-2',
    brandId: 'brand-2',
    brandName: 'Another Brand',
    brandSlug: 'another-brand',
    userId: 'user-2',
    fieldName: 'name',
    flaggedContent: 'Buy Now Brand',
    previousContent: null,
    flagReason: 'SEO spam',
    tier: 'flag',
    status: 'pending',
    reviewedAt: null,
    createdAt: '2026-05-22T00:00:00Z',
  },
]

describe('FlaggedTable', () => {
  it('renders flags with checkboxes', () => {
    render(<FlaggedTable flags={mockFlags} />)

    const checkboxes = screen.getAllByRole('checkbox')
    // One per row + select-all = 3
    expect(checkboxes.length).toBeGreaterThanOrEqual(2)
  })

  it('shows batch action buttons when checkboxes are selected', () => {
    render(<FlaggedTable flags={mockFlags} />)

    // Batch buttons should not be visible initially
    expect(screen.queryByText(/review selected/i)).not.toBeInTheDocument()

    // Select first flag
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[1]) // first row checkbox (index 0 is select-all)

    // Batch buttons should now appear
    expect(screen.getByText(/review selected/i)).toBeInTheDocument()
    expect(screen.getByText(/dismiss selected/i)).toBeInTheDocument()
  })
})
