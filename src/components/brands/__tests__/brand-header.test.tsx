// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { BrandHeader } from '../brand-header'
import type { Brand } from '@/lib/types'
import zh from '../../../../messages/zh-TW.json'

function makeBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: 'brand-1',
    name: 'Test Brand',
    slug: 'test-brand',
    description: 'A brand',
    heroImageUrl: null,
    status: 'approved',
    category: 'fashion',
    isVerified: false,
    isDemo: false,
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
    brandHighlights: null,
    siteContent: null,
    tags: [],
    foundingYear: null,
    contactEmail: null,
    submittedAt: '2026-01-01T00:00:00Z',
    approvedAt: '2026-01-02T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('BrandHeader — verified badge', () => {
  it('shows verified badge tooltip when isVerified is true', () => {
    renderWithIntl(<BrandHeader brand={makeBrand({ isVerified: true })} />)
    expect(screen.getByText('品牌經營')).toBeInTheDocument()
    expect(screen.getByTitle('由品牌方經營管理')).toBeInTheDocument()
  })

  it('does not show verified badge when isVerified is false', () => {
    renderWithIntl(<BrandHeader brand={makeBrand({ isVerified: false })} />)
    expect(screen.queryByText('品牌經營')).not.toBeInTheDocument()
    expect(screen.queryByTitle('由品牌方經營管理')).not.toBeInTheDocument()
  })

  it('does not show verified badge based on approvedAt alone', () => {
    renderWithIntl(<BrandHeader brand={makeBrand({ isVerified: false, approvedAt: '2026-05-01' })} />)
    expect(screen.queryByText('品牌經營')).not.toBeInTheDocument()
    expect(screen.queryByTitle('由品牌方經營管理')).not.toBeInTheDocument()
  })
})
