// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { expect, it } from 'vitest'
import { EditReviewBanner } from '../edit-review-banner'
import type { PendingBrandEdit } from '@/lib/types/brand'

const BASE: PendingBrandEdit = {
  id: 'edit-1',
  status: 'pending',
  createdAt: '2026-06-12T10:00:00Z',
  reviewerNotes: null,
  reviewedAt: null,
  reviewedBy: null,
  brandId: 'b1',
  submittedBy: 'u1',
  proposedData: {},
  updatedAt: '2026-06-12T10:00:00Z',
}

it('shows pending state', () => {
  render(<EditReviewBanner edit={{ ...BASE, status: 'pending' }} brandSlug="test-brand" />)
  expect(screen.getAllByText(/審核中|under review/i).length).toBeGreaterThan(0)
})

it('shows rejected state with reviewer notes', () => {
  render(
    <EditReviewBanner
      edit={{
        ...BASE,
        status: 'rejected',
        reviewerNotes: 'Fix the description',
        reviewedAt: '2026-06-12T12:00:00Z',
      }}
      brandSlug="test-brand"
    />
  )
  expect(screen.getByText('Fix the description')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /重新編輯/ })).toBeInTheDocument()
})

it('shows approved state and can be dismissed', () => {
  render(
    <EditReviewBanner
      edit={{ ...BASE, status: 'approved', reviewedAt: '2026-06-12T12:00:00Z' }}
      brandSlug="test-brand"
    />
  )
  expect(screen.getByText(/已通過|approved/i)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /dismiss|X|關閉/i }))
  expect(screen.queryByText(/已通過/)).not.toBeInTheDocument()
})

it('renders nothing when edit is null', () => {
  const { container } = render(<EditReviewBanner edit={null} brandSlug="test-brand" />)
  expect(container.firstChild).toBeNull()
})
