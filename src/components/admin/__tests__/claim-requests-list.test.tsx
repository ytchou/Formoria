// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClaimRequestsList } from '../claim-requests-list'
import { approveClaimAction, rejectClaimAction } from '@/app/admin/actions'
import type { ClaimRequest } from '@/lib/services/claim-requests'

vi.mock('@/app/admin/actions', () => ({
  approveClaimAction: vi.fn(),
  rejectClaimAction: vi.fn(),
}))

const FAKE_PENDING_CLAIM: ClaimRequest = {
  id: 'claim-1',
  brandId: 'brand-1',
  userId: 'user-1',
  proofType: 'social_post',
  proofUrl: 'https://instagram.com/p/abc123',
  proofNotes: 'Posted the studio walkthrough on our official account.',
  status: 'pending',
  reviewerNotes: null,
  reviewedAt: null,
  reviewedBy: null,
  createdAt: '2026-06-01T10:00:00Z',
  brandName: 'Sun Room Studio',
  brandSlug: 'sun-room-studio',
  requesterEmail: 'owner@sunroom.test',
}

describe('ClaimRequestsList', () => {
  beforeEach(() => {
    vi.mocked(approveClaimAction).mockReset()
    vi.mocked(rejectClaimAction).mockReset()
  })

  it('clicking Approve calls approveClaimAction with the claim id', async () => {
    const user = userEvent.setup()

    render(<ClaimRequestsList claimRequests={[FAKE_PENDING_CLAIM]} />)

    await user.click(screen.getByText('Sun Room Studio'))
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(approveClaimAction).toHaveBeenCalledWith(FAKE_PENDING_CLAIM.id)
  })

  it('requires notes before confirming rejection', async () => {
    const user = userEvent.setup()

    render(<ClaimRequestsList claimRequests={[FAKE_PENDING_CLAIM]} />)

    await user.click(screen.getByText('Sun Room Studio'))
    await user.click(screen.getByRole('button', { name: 'Reject' }))
    await user.type(
      screen.getByPlaceholderText('Why are you rejecting this claim?'),
      'insufficient proof'
    )
    await user.click(screen.getByRole('button', { name: 'Confirm reject' }))

    expect(rejectClaimAction).toHaveBeenCalledWith(
      FAKE_PENDING_CLAIM.id,
      'insufficient proof'
    )
  })

  it('renders unsafe proof URLs as plain text instead of links', async () => {
    const user = userEvent.setup()

    render(
      <ClaimRequestsList
        claimRequests={[
          {
            ...FAKE_PENDING_CLAIM,
            proofUrl: 'javascript:alert(1)',
          },
        ]}
      />
    )

    expect(screen.queryByRole('link', { name: 'View proof' })).not.toBeInTheDocument()
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument()

    await user.click(screen.getByText('Sun Room Studio'))

    expect(screen.getAllByText('javascript:alert(1)')).toHaveLength(2)
  })
})
