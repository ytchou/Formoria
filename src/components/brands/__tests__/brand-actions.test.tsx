// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'

import zh from '../../../../messages/zh-TW.json'
import { BrandActions } from '../brand-actions'

vi.mock('@/lib/analytics', () => ({
  trackBrandPageShared: vi.fn(),
  trackExternalLinkClicked: vi.fn(),
}))

vi.mock('@/components/brands/evidence-dialog', () => ({
  EvidenceDialog: () => <button aria-label="回報產地資訊">mock-evidence</button>,
}))

vi.mock('@/components/brands/report-dialog', () => ({
  ReportDialog: () => <button aria-label="檢舉">mock-report</button>,
}))

vi.mock('../save-brand-button', () => ({
  SaveBrandButton: ({ brandId }: { brandId: string }) => (
    <button aria-label="收藏這個品牌" data-brand-id={brandId} type="button">
      mock-save
    </button>
  ),
}))

vi.mock('../like-brand-button', () => ({
  LikeBrandButton: ({ brandId }: { brandId: string }) => (
    <button aria-label="支持這個品牌，目前有 12 個支持" data-brand-id={brandId} type="button">
      支持 12
    </button>
  ),
}))

function renderWithIntl(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('BrandActions', () => {
  it('renders the admin menu immediately after the report action', () => {
    renderWithIntl(
      <BrandActions
        adminSlot={<button aria-label="管理選單">mock-admin</button>}
        brandId="brand-1"
        brandName="測試品牌"
        brandSlug="test-brand"
        websiteUrl="https://example.com"
      />
    )

    const reportButton = screen.getByRole('button', { name: '檢舉' })
    const adminButton = screen.getByRole('button', { name: '管理選單' })
    expect(reportButton.nextElementSibling).toBe(adminButton)
  })

  it('renders an inline save button in the actions row', () => {
    renderWithIntl(
      <BrandActions
        brandId="brand-1"
        brandName="測試品牌"
        brandSlug="test-brand"
        websiteUrl="https://example.com"
      />
    )

    expect(screen.getByRole('button', { name: /收藏/ })).toBeInTheDocument()
  })

  it('renders public support before the private save action', () => {
    renderWithIntl(
      <BrandActions
        brandId="brand-1"
        brandName="測試品牌"
        brandSlug="test-brand"
        websiteUrl="https://example.com"
      />
    )

    const supportButton = screen.getByRole('button', { name: /支持這個品牌/ })
    const saveButton = screen.getByRole('button', { name: /收藏這個品牌/ })
    expect(supportButton).toHaveTextContent('支持 12')
    expect(supportButton.nextElementSibling).toBe(saveButton)
  })

  it('renders ShareDialog trigger instead of inline share button', () => {
    renderWithIntl(
      <BrandActions
        brandId="brand-1"
        brandName="測試品牌"
        brandSlug="test-brand"
        websiteUrl={null}
      />
    )

    expect(screen.getByRole('button', { name: /分享/i })).toBeInTheDocument()
  })

  it('has data-ph-no-autocapture on the Visit Website link', () => {
    renderWithIntl(
      <BrandActions
        brandId="brand-1"
        brandName="測試品牌"
        brandSlug="test-brand"
        websiteUrl="https://example.com"
      />
    )

    const visitLinks = screen.getAllByRole('link', { name: /前往官網|前往品牌官網/ })
    for (const link of visitLinks) {
      expect(link).toHaveAttribute('data-ph-no-autocapture')
    }
  })
})
