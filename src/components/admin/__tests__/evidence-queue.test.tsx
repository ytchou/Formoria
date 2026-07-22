// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it } from 'vitest'
import type { OriginEvidence } from '@/lib/services/origin-evidence'
import messages from '../../../../messages/zh-TW.json'
import { EvidenceQueue } from '../evidence-queue'

function makeEvidence(overrides: Partial<OriginEvidence> = {}): OriginEvidence {
  return {
    id: 'evidence-1',
    brandId: 'brand-1',
    userId: 'user-1',
    stance: 'supports',
    productName: '經典商品',
    sourceType: 'product_label',
    notes: '包裝標示台灣製造。',
    photos: [],
    status: 'pending',
    reviewedAt: null,
    reviewedBy: null,
    reviewerNotes: null,
    createdAt: '2026-07-20T10:00:00Z',
    brandName: '測試品牌',
    brandSlug: 'test-brand',
    brandMitStatus: 'verified',
    ...overrides,
  }
}

function renderQueue(evidence: OriginEvidence[]) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={messages}>
      <EvidenceQueue evidence={evidence} />
    </NextIntlClientProvider>,
  )
}

describe('EvidenceQueue', () => {
  it('renders pending evidence rows with approve and reject actions', async () => {
    const user = userEvent.setup()

    renderQueue([makeEvidence({ brandName: '好物選', stance: 'contradicts' })])

    expect(screen.getByText('好物選')).toBeInTheDocument()
    await user.click(screen.getByText('好物選'))
    expect(screen.getByText('反駁台灣製造聲明')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '核准' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '拒絕' })).toBeInTheDocument()
  })

  it('offers strip-declaration only for declared brands', async () => {
    const user = userEvent.setup()

    renderQueue([makeEvidence({ brandMitStatus: 'declared' })])

    await user.click(screen.getByText('測試品牌'))
    expect(screen.getByText('移除聲明')).toBeInTheDocument()
  })
})
