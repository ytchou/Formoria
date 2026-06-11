// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { ClaimRequestsList } from '../claim-requests-list'
import {
  approveClaimAction,
  rejectClaimAction,
  rejectMitAction,
  verifyMitAction,
} from '@/app/admin/actions'
import type { ClaimRequest } from '@/lib/services/claim-requests'
import messages from '../../../../messages/zh-TW.json'

vi.mock('@/app/admin/actions', () => ({
  approveClaimAction: vi.fn(),
  rejectClaimAction: vi.fn(),
  rejectMitAction: vi.fn(),
  verifyMitAction: vi.fn(),
}))

type ClaimRequestWithSignedProof = ClaimRequest & {
  proofEvidence: Array<ClaimRequest['proofEvidence'][number] & { signedUrl?: string }>
}

const FAKE_PENDING_CLAIM: ClaimRequestWithSignedProof = {
  id: 'claim-1',
  brandId: 'brand-1',
  userId: 'user-1',
  proofType: 'social_dm',
  proofUrl: 'https://instagram.com/p/abc123',
  proofNotes: 'Posted the studio walkthrough on our official account.',
  proofEvidence: [
    {
      type: 'social_dm',
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
}

function renderList(claimRequests: Partial<ClaimRequestWithSignedProof>[]) {
  const normalized = claimRequests.map((claimRequest) => ({
    ...FAKE_PENDING_CLAIM,
    ...claimRequest,
    proofEvidence: claimRequest.proofEvidence ?? FAKE_PENDING_CLAIM.proofEvidence,
  }))

  return render(
    <NextIntlClientProvider locale="zh-TW" messages={messages}>
      <ClaimRequestsList claimRequests={normalized} />
    </NextIntlClientProvider>
  )
}

describe('ClaimRequestsList', () => {
  beforeEach(() => {
    vi.mocked(approveClaimAction).mockReset()
    vi.mocked(rejectClaimAction).mockReset()
    vi.mocked(rejectMitAction).mockReset()
    vi.mocked(verifyMitAction).mockReset()
  })

  it('clicking Approve calls approveClaimAction with the claim id', async () => {
    const user = userEvent.setup()

    renderList([FAKE_PENDING_CLAIM])

    await user.click(screen.getByText('Sun Room Studio'))
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(approveClaimAction).toHaveBeenCalledWith(FAKE_PENDING_CLAIM.id)
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

  it('clicking Verify MIT calls verifyMitAction with the brand id and cert', async () => {
    const user = userEvent.setup()

    renderList([{ mitSmileCert: 'MIT-2023-12345' }])

    await user.click(screen.getByText('Sun Room Studio'))
    await user.click(screen.getByRole('button', { name: 'Verify MIT' }))

    expect(verifyMitAction).toHaveBeenCalledWith('brand-1', 'MIT-2023-12345')
  })

  it('renders each submitted proof with its type, link, thumbnail and note', () => {
    renderList([{ id: 'c1', brandName: 'Wuxiang', status: 'pending',
      proofEvidence: [
        { type: 'domain_email', url: 'mailto:owner@wuxiang.com', note: 'mailbox' },
        { type: 'backend_screenshot', imageKey: 'claim-proofs/u1/b1/a.webp', signedUrl: 'https://x.supabase.co/sign/a' },
      ], mitSmileCert: 'MIT-2023-12345' }])
    fireEvent.click(screen.getByText('Wuxiang'))
    expect(screen.getByText('品牌網域信箱')).toBeInTheDocument()
    expect(screen.getByText('後台截圖')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /owner@wuxiang.com/ })).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAttribute('src', expect.stringContaining('sign/a'))
  })
})
