// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/app/admin/actions', () => ({
  reviewReportAction: vi.fn(),
  revokeOwnershipAction: vi.fn(),
}))

import { ReportsTable } from '../reports-table'
import { revokeOwnershipAction } from '@/app/admin/actions'
import type { BrandReport } from '@/lib/services/reports'

const mockReports: BrandReport[] = [
  {
    id: 'r1',
    brandId: 'b1',
    brandName: 'Test Brand',
    brandSlug: 'test-brand',
    reason: 'not_mit',
    notes: null,
    status: 'pending',
    reviewedAt: null,
    createdAt: '2026-05-29T00:00:00.000Z',
  },
]

const disputeReport: BrandReport = {
  id: 'r1',
  brandId: 'b1',
  brandName: '好山茶行',
  brandSlug: 'hao-shan-tea',
  reason: 'ownership_dispute',
  status: 'pending',
  notes: '我是品牌登記負責人',
  reporterEmail: 'mei.lin@example.com',
  brandHasOwner: true,
  reviewedAt: null,
  createdAt: '2026-07-16T00:00:00Z',
}

describe('ReportsTable', () => {
  it('renders the brand name', () => {
    render(<ReportsTable reports={mockReports} />)
    expect(screen.getByText('Test Brand')).toBeInTheDocument()
  })

  it('renders the reason label', () => {
    render(<ReportsTable reports={mockReports} />)
    expect(screen.getByText('Not Made in Taiwan')).toBeInTheDocument()
  })

  it('renders Review and Dismiss buttons after expanding row', () => {
    render(<ReportsTable reports={mockReports} />)
    fireEvent.click(screen.getByText('Not Made in Taiwan'))
    expect(screen.getByRole('button', { name: /Review/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Dismiss/i })).toBeInTheDocument()
  })

  it('renders empty state when no reports', () => {
    render(<ReportsTable reports={[]} />)
    expect(screen.getByText(/No pending reports/i)).toBeInTheDocument()
  })

  it('shows reporter email and revoke section for owned-brand dispute rows', () => {
    render(<ReportsTable reports={[disputeReport]} />)

    fireEvent.click(screen.getByText('Ownership dispute'))

    expect(screen.getByText('mei.lin@example.com')).toBeInTheDocument()
    expect(screen.getByLabelText(/Revocation reason/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revoke ownership' })).toBeInTheDocument()
  })

  it('hides the revoke section when the brand has no owner', () => {
    render(<ReportsTable reports={[{ ...disputeReport, brandHasOwner: false }]} />)

    fireEvent.click(screen.getByText('Ownership dispute'))

    expect(screen.queryByRole('button', { name: 'Revoke ownership' })).not.toBeInTheDocument()
  })

  it('disables revoke until a reason is entered and confirms via alert dialog', async () => {
    const user = userEvent.setup()
    render(<ReportsTable reports={[disputeReport]} />)

    await user.click(screen.getByText('Ownership dispute'))
    const revokeButton = screen.getByRole('button', { name: 'Revoke ownership' })
    expect(revokeButton).toBeDisabled()

    await user.type(screen.getByLabelText(/Revocation reason/i), 'Dispute upheld')
    expect(revokeButton).toBeEnabled()
    await user.click(revokeButton)
    await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))

    await waitFor(() => {
      expect(revokeOwnershipAction).toHaveBeenCalledWith('b1', 'Dispute upheld')
    })
  })
})
