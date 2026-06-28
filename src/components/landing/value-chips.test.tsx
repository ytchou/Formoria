// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import zhMessages from '../../../messages/zh-TW.json'
import type { TaxonomyTag } from '@/lib/types'
import type { Brand } from '@/lib/types/brand'

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => <a href={href} {...props}>{children}</a>,
}))

vi.mock('@/components/brands/brand-card', () => ({
  BrandCard: ({ brand }: { brand: Brand }) => <div data-testid="brand-card">{brand.name}</div>,
}))

import ValueChips from './value-chips'

function renderWithZhTW(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

const mockTags: TaxonomyTag[] = [
  { id: '1', slug: 'sustainable', name: 'Sustainable', nameZh: '永續經營', category: 'value', isActive: true, createdAt: '2024-01-01' },
  { id: '2', slug: 'handmade', name: 'Handmade', nameZh: '手工製作', category: 'value', isActive: true, createdAt: '2024-01-01' },
  { id: '3', slug: 'local-ingredients', name: 'Local Ingredients', nameZh: '在地食材', category: 'value', isActive: true, createdAt: '2024-01-01' },
]

const mockBrand: Brand = {
  id: 'b1',
  name: 'Test Brand',
  slug: 'test-brand',
  description: null,
  heroImageUrl: null,
  status: 'approved',
  category: null,
  isVerified: false,
  isDemo: false,
  foundingYear: null,
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
  contactEmail: null,
  brandHighlights: null,
  siteContent: null,
  tags: [{ id: '1', slug: 'sustainable', name: 'Sustainable', nameZh: '永續經營', category: 'value', isActive: true, createdAt: '2024-01-01' }],
  submittedAt: '2024-01-01',
  approvedAt: '2024-01-01',
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
}

describe('ValueBrandShowcase', () => {
  it('renders tag names as chip buttons and heading', () => {
    renderWithZhTW(<ValueChips brands={[mockBrand]} tags={mockTags} />)

    expect(screen.getByText('依品牌價值瀏覽')).toBeInTheDocument()
    expect(screen.getByText('全部')).toBeInTheDocument()
    expect(screen.getByText('永續經營')).toBeInTheDocument()
    expect(screen.getByText('手工製作')).toBeInTheDocument()
  })

  it('renders brand cards when brands are provided', () => {
    renderWithZhTW(<ValueChips brands={[mockBrand]} tags={mockTags} />)
    expect(screen.getByTestId('brand-card')).toBeInTheDocument()
    expect(screen.getByText('Test Brand')).toBeInTheDocument()
  })

  it('shows empty message when no tags and no brands match', () => {
    renderWithZhTW(<ValueChips brands={[]} tags={[]} />)
    expect(screen.getByText('目前沒有標記此價值的品牌')).toBeInTheDocument()
  })
})
