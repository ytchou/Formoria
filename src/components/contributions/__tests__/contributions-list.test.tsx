// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it } from 'vitest'

import type { OriginEvidence } from '@/lib/services/origin-evidence'
import zhMessages from '../../../../messages/zh-TW.json'
import { ContributionsList } from '../contributions-list'

const contributionMessages = {
  status: {
    pending: '\u5f85\u5be9\u6838',
    approved: '\u5df2\u901a\u904e',
    rejected: '\u672a\u901a\u904e',
  },
  stance: {
    supports: '\u652f\u6301\u53f0\u7063\u88fd\u9020',
    contradicts: '\u4e0d\u652f\u6301\u53f0\u7063\u88fd\u9020',
  },
  emptyTitle: '\u5c1a\u7121\u8ca2\u737b',
  emptyDescription:
    '\u63d0\u4f9b\u7522\u5730\u8b49\u64da\uff0c\u5e6b\u52a9\u793e\u7fa4\u4e86\u89e3\u66f4\u591a\u53f0\u7063\u54c1\u724c\u3002',
  exploreBrands: zhMessages.favorites.exploreBrands,
}

function makeEvidence(overrides: Partial<OriginEvidence> = {}): OriginEvidence {
  return {
    id: 'evidence-1',
    brandId: 'brand-1',
    userId: 'user-1',
    stance: 'supports',
    productName: 'Classic canvas shoes',
    sourceType: 'product_label',
    notes: 'The product label states that it was made in Taiwan.',
    photos: [{ path: 'origin-evidence/user-1/label.webp' }],
    status: 'pending',
    reviewedAt: null,
    reviewedBy: null,
    reviewerNotes: null,
    createdAt: '2026-07-20T08:30:00.000Z',
    brandName: 'Daxi Canvas Shoes',
    brandSlug: 'daxi-canvas-shoes',
    brandMitStatus: 'declared',
    ...overrides,
  }
}

function renderList(items: OriginEvidence[]) {
  return render(
    <NextIntlClientProvider
      locale="zh-TW"
      messages={{ ...zhMessages, contributions: contributionMessages }}
    >
      <ContributionsList items={items} />
    </NextIntlClientProvider>,
  )
}

describe('ContributionsList', () => {
  it('lists own evidence with status badges', () => {
    renderList([
      makeEvidence(),
      makeEvidence({
        id: 'evidence-2',
        brandId: 'brand-2',
        brandName: '3:15 PM',
        brandSlug: '3h1',
        stance: 'contradicts',
        status: 'approved',
      }),
      makeEvidence({
        id: 'evidence-3',
        brandId: 'brand-3',
        brandName: 'Yongsheng Rice Noodles',
        brandSlug: 'yongsheng-rice-noodles',
        status: 'rejected',
      }),
    ])

    expect(screen.getByText('Daxi Canvas Shoes')).toBeInTheDocument()
    expect(screen.getByText('3:15 PM')).toBeInTheDocument()
    expect(screen.getByText('Yongsheng Rice Noodles')).toBeInTheDocument()
    expect(screen.getByText(contributionMessages.status.pending)).toBeInTheDocument()
    expect(screen.getByText(contributionMessages.status.approved)).toBeInTheDocument()
    expect(screen.getByText(contributionMessages.status.rejected)).toBeInTheDocument()
  })

  it('shows empty state with link to browse brands', () => {
    renderList([])

    expect(
      screen.getByRole('link', {
        name: new RegExp(zhMessages.favorites.exploreBrands),
      }),
    ).toHaveAttribute('href', '/brands')
  })
})
