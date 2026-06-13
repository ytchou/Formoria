// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PendingEditsList } from '../pending-edits-list'

vi.mock('@/app/admin/actions', () => ({
  approvePendingEditAction: vi.fn().mockResolvedValue(undefined),
  rejectPendingEditAction: vi.fn().mockResolvedValue(undefined),
}))

const EDITS = [{
  id: 'edit-1',
  brand: {
    id: 'b1',
    name: '暖木家居',
    slug: 'wanjia',
    description: 'Original description',
    logoUrl: null,
    heroImageUrl: null,
    category: null,
    contactEmail: 'owner@example.com',
    brandHighlights: null,
    foundingYear: 2020,
    purchaseLinks: [],
    socialLinks: {},
    retailLocations: [],
    productPhotos: [],
    siteContent: null,
  },
  submittedBy: 'user-1',
  brandId: 'b1',
  createdAt: '2026-06-12T10:00:00Z',
  updatedAt: '2026-06-12T10:00:00Z',
  status: 'pending' as const,
  proposedData: { name: '暖木家居 Updated', description: 'New description' },
  reviewerNotes: null, reviewedAt: null, reviewedBy: null,
}]

it('renders a row per pending edit', () => {
  render(<PendingEditsList edits={EDITS} />)
  expect(screen.getByText('暖木家居')).toBeInTheDocument()
})

it('expands to show diff view on 展開 click', async () => {
  render(<PendingEditsList edits={EDITS} />)
  fireEvent.click(screen.getByText('展開'))
  expect(await screen.findByText('目前版本')).toBeInTheDocument()
  expect(await screen.findByText('提案修改')).toBeInTheDocument()
})

it('shows reject note input when 退回 is clicked', async () => {
  render(<PendingEditsList edits={EDITS} />)
  fireEvent.click(screen.getByText('展開'))
  fireEvent.click(await screen.findByText('退回'))
  expect(await screen.findByPlaceholderText(/退回原因/)).toBeInTheDocument()
})

describe('PendingEditsList', () => {
  it('shows empty state when no edits', () => {
    render(<PendingEditsList edits={[]} />)
    expect(screen.getByText('目前沒有待審核的編輯申請。')).toBeInTheDocument()
  })

  it('shows cancel button after clicking 退回', async () => {
    render(<PendingEditsList edits={EDITS} />)
    fireEvent.click(screen.getByText('展開'))
    fireEvent.click(await screen.findByText('退回'))
    expect(await screen.findByText('取消')).toBeInTheDocument()
    expect(await screen.findByText('確認退回')).toBeInTheDocument()
  })

  it('collapses reject note on 取消 click', async () => {
    render(<PendingEditsList edits={EDITS} />)
    fireEvent.click(screen.getByText('展開'))
    fireEvent.click(await screen.findByText('退回'))
    fireEvent.click(await screen.findByText('取消'))
    expect(screen.queryByPlaceholderText(/退回原因/)).not.toBeInTheDocument()
  })
})
