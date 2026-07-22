// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { ClaimRequestsList } from '../claim-requests-list'
import {
  approveClaimAction,
  rejectClaimAction,
} from '@/app/admin/actions'
import type { ClaimRequest } from '@/lib/services/claim-requests'
import messages from '../../../../messages/en.json'

vi.mock('@/app/admin/actions', () => ({
  approveClaimAction: vi.fn(),
  rejectClaimAction: vi.fn(),
}))

type ClaimRequestWithSignedProof = ClaimRequest & {
  proofEvidence: Array<ClaimRequest['proofEvidence'][number] & { signedUrl?: string }>
}

const FAKE_PENDING_CLAIM: ClaimRequestWithSignedProof = {
  id: 'claim-1',
  brandId: 'brand-1',
  userId: 'user-1',
  proofType: 'business_doc',
  proofUrl: 'https://instagram.com/p/abc123',
  proofNotes: 'Posted the studio walkthrough on our official account.',
  proofEvidence: [
    {
      type: 'business_doc',
      url: 'https://instagram.com/p/abc123',
      note: 'Posted the studio walkthrough on our official account.',
    },
    {
      type: 'backend_screenshot',
      imageKey: 'claim-proofs/user-1/brand-1/admin.webp',
      signedUrl: 'https://x.supabase.co/sign/admin',
    },
  ],
  mitSmileCert: null,
  status: 'pending',
  reviewerNotes: null,
  reviewedAt: null,
  reviewedBy: null,
  createdAt: '2026-06-01T10:00:00Z',
  brandName: 'Sun Room Studio',
  brandSlug: 'sun-room-studio',
  requesterEmail: 'owner@sunroom.test',
  proofCleanupStatus: null,
}

function renderList(claimRequests: Partial<ClaimRequestWithSignedProof>[]) {
  const normalized = claimRequests.map((claimRequest) => ({
    ...FAKE_PENDING_CLAIM,
    ...claimRequest,
    proofEvidence: claimRequest.proofEvidence ?? FAKE_PENDING_CLAIM.proofEvidence,
  }))

  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ClaimRequestsList claimRequests={normalized} />
    </NextIntlClientProvider>
  )
}

describe('ClaimRequestsList', () => {
  beforeEach(() => {
    vi.mocked(approveClaimAction).mockReset()
    vi.mocked(rejectClaimAction).mockReset()
  })

  it('clicking Approve calls approveClaimAction with the claim id', async () => {
    const user = userEvent.setup()

    renderList([FAKE_PENDING_CLAIM])

    await user.click(screen.getByText('Sun Room Studio'))
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(approveClaimAction).toHaveBeenCalledWith(FAKE_PENDING_CLAIM.id)
  })

  it('shows cleanup status for terminal claims', async () => {
    const user = userEvent.setup()
    renderList([
      { id: 'queued', brandName: 'Queued Brand', status: 'approved', proofCleanupStatus: 'pending' },
      { id: 'failed', brandName: 'Failed Brand', status: 'rejected', proofCleanupStatus: 'failed' },
      { id: 'deleted', brandName: 'Deleted Brand', status: 'approved', proofCleanupStatus: 'completed' },
    ])

    await user.click(screen.getByRole('tab', { name: 'All (3)' }))

    await user.click(screen.getByText('Queued Brand'))
    expect(screen.getByText('Queued / retrying')).toBeInTheDocument()
    expect(screen.getByText('Deletion is queued and will retry automatically.')).toBeInTheDocument()

    await user.click(screen.getByText('Failed Brand'))
    expect(screen.getByText('Retry failed')).toBeInTheDocument()
    expect(screen.getByText('Automatic retries are exhausted. Admin intervention is required.')).toBeInTheDocument()

    await user.click(screen.getByText('Deleted Brand'))
    expect(screen.getByText('Deleted')).toBeInTheDocument()
    expect(screen.getByText('Private proof files were deleted.')).toBeInTheDocument()
  })

  it('hides cleanup status for null cleanup state and pending claims', async () => {
    const user = userEvent.setup()
    renderList([
      { id: 'terminal-null', brandName: 'No Cleanup State', status: 'approved', proofCleanupStatus: null },
      { id: 'still-pending', brandName: 'Pending Decision', status: 'pending', proofCleanupStatus: 'pending' },
    ])

    await user.click(screen.getByRole('tab', { name: 'All (2)' }))
    await user.click(screen.getByText('No Cleanup State'))
    expect(screen.queryByText('Proof file cleanup')).not.toBeInTheDocument()

    await user.click(screen.getByText('Pending Decision'))
    expect(screen.queryByText('Proof file cleanup')).not.toBeInTheDocument()
  })

  it('shows an action warning as a successful decision status, not an error', async () => {
    const user = userEvent.setup()
    vi.mocked(approveClaimAction).mockResolvedValue({ warning: 'cleanup queued' })
    renderList([FAKE_PENDING_CLAIM])

    await user.click(screen.getByText('Sun Room Studio'))
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Decision saved. Proof deletion remains queued for automatic retry.'
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the same non-error cleanup warning after rejection', async () => {
    const user = userEvent.setup()
    vi.mocked(rejectClaimAction).mockResolvedValue({ warning: 'cleanup queued' })
    renderList([FAKE_PENDING_CLAIM])

    await user.click(screen.getByText('Sun Room Studio'))
    await user.click(screen.getByRole('button', { name: 'Reject' }))
    await user.type(
      screen.getByPlaceholderText('Why are you rejecting this claim?'),
      'insufficient proof'
    )
    await user.click(screen.getByRole('button', { name: 'Confirm reject' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Decision saved. Proof deletion remains queued for automatic retry.'
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps action errors distinct from cleanup warnings', async () => {
    const user = userEvent.setup()
    vi.mocked(approveClaimAction).mockResolvedValue({ error: 'approval failed' })
    renderList([FAKE_PENDING_CLAIM])

    await user.click(screen.getByText('Sun Room Studio'))
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('approval failed')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('flags an existing owner and disables approval', async () => {
    const user = userEvent.setup()
    renderList([{
      existingOwnedBrand: {
        brandId: 'owned-1',
        brandName: 'Existing Brand',
        brandSlug: 'existing-brand',
      },
    }])

    await user.click(screen.getByText('Sun Room Studio'))

    expect(screen.getByText('Already owns a brand')).toBeInTheDocument()
    expect(screen.getByText('Existing Brand')).toHaveAttribute('href', '/brands/existing-brand')
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
  })

  it('requires notes before confirming rejection', async () => {
    const user = userEvent.setup()

    renderList([FAKE_PENDING_CLAIM])

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

  it('renders each submitted proof with its type, email, thumbnail and note', () => {
    renderList([{ id: 'c1', brandName: 'Wuxiang', status: 'pending',
      proofEvidence: [
        { type: 'domain_email', url: 'owner@wuxiang.com', note: 'mailbox' },
        { type: 'backend_screenshot', imageKey: 'claim-proofs/u1/b1/a.webp', signedUrl: 'https://x.supabase.co/sign/a' },
      ], mitSmileCert: 'MIT-2023-12345' }])
    fireEvent.click(screen.getByText('Wuxiang'))
    expect(screen.getByText('Brand domain email')).toBeInTheDocument()
    expect(screen.getByText('Admin/backend screenshot')).toBeInTheDocument()
    expect(screen.getByText('owner@wuxiang.com')).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAttribute('src', expect.stringContaining('sign/a'))
  })
})
