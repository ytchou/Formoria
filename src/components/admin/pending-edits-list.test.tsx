// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { PendingEditsList } from './pending-edits-list'
import type { PendingBrandEditWithBrand } from '@/lib/types/brand'
import messages from '../../../messages/zh-TW.json'

vi.mock('@/app/admin/actions', () => ({
  approvePendingEditAction: vi.fn().mockResolvedValue(undefined),
  rejectPendingEditAction: vi.fn().mockResolvedValue(undefined),
}))

type PendingEditWithRisk = PendingBrandEditWithBrand & {
  moderationRiskLevel?: 'high' | 'medium' | 'clean'
}

function makeEdit(overrides: Partial<PendingEditWithRisk> = {}): PendingEditWithRisk {
  return {
    id: 'edit-1',
    brand: {
      id: 'brand-1',
      name: '暖木家居',
      slug: 'warm-home',
      description: 'Original description',
      heroImageUrl: null,
      category: null,
      contactEmail: 'owner@example.com',
      brandHighlights: null,
      foundingYear: 2020,
      socialInstagram: null,
      socialThreads: null,
      socialFacebook: null,
      purchaseWebsite: null,
      purchasePinkoi: null,
      purchaseShopee: null,
      otherUrls: [],
      retailLocations: [],
      customerVoices: [],
      productPhotos: [],
      siteContent: null,
    },
    submittedBy: 'user-1',
    brandId: 'brand-1',
    createdAt: '2026-06-12T10:00:00Z',
    updatedAt: '2026-06-12T10:00:00Z',
    status: 'pending',
    proposedData: { name: '暖木家居 Updated' },
    reviewerNotes: null,
    reviewedAt: null,
    reviewedBy: null,
    ...overrides,
  }
}

describe('PendingEditsList moderation risk badges', () => {
  it('renders a high risk badge', () => {
    render(
      <NextIntlClientProvider locale="zh-TW" messages={messages}>
        <PendingEditsList edits={[makeEdit({ moderationRiskLevel: 'high' })]} />
      </NextIntlClientProvider>
    )
    expect(screen.getByText('高風險')).toBeInTheDocument()
  })

  it('renders a medium risk badge', () => {
    render(
      <NextIntlClientProvider locale="zh-TW" messages={messages}>
        <PendingEditsList edits={[makeEdit({ moderationRiskLevel: 'medium' })]} />
      </NextIntlClientProvider>
    )
    expect(screen.getByText('中風險')).toBeInTheDocument()
  })

  it('does not render a risk badge for clean or absent risk', () => {
    render(
      <NextIntlClientProvider locale="zh-TW" messages={messages}>
        <PendingEditsList
          edits={[
            makeEdit({ id: 'clean-edit', moderationRiskLevel: 'clean' }),
            makeEdit({ id: 'absent-edit', brandId: 'brand-2' }),
          ]}
        />
      </NextIntlClientProvider>
    )

    expect(screen.queryByText('高風險')).not.toBeInTheDocument()
    expect(screen.queryByText('中風險')).not.toBeInTheDocument()
  })
})
