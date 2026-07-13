// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Brand } from '@/lib/types/brand'

vi.mock('next-intl', () => ({
  useLocale: () => 'zh-TW',
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  usePathname: () => '/',
}))

vi.mock('@/lib/analytics', () => ({
  trackBrandCardClicked: vi.fn(),
}))

vi.mock('@/lib/auth/use-user', () => ({
  useUser: () => ({ user: null, loading: false }),
}))

vi.mock('@/hooks/use-saved-brands', () => ({
  useSavedBrands: () => ({
    savedIds: new Set<string>(),
    toggle: vi.fn(),
    loading: false,
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
}))

vi.mock('next/image', () => ({
  default: ({ alt = '', ...props }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={String(alt)} {...props} />
  ),
}))

import FilterableBrandShowcase from './filterable-brand-showcase'

const baseBrand: Brand = {
  id: 'brand-1',
  slug: 'brand-1',
  name: 'Brand 1',
  category: '服飾鞋履',
  productType: 'fashion',
  description: 'A Taiwan-made brand.',
  descriptionEn: 'A Taiwan-made brand.',
  status: 'approved',
  isVerified: false,
  isDemo: false,
  heroImageUrl: null,
  city: null,
  foundingYear: 2020,
  productPhotos: [],
  socialInstagram: null,
  socialThreads: null,
  socialFacebook: null,
  purchaseWebsite: null,
  purchasePinkoi: null,
  purchaseShopee: null,
  otherUrls: [],
  retailLocations: [],
  contactEmail: null,
  siteContent: null,
  priceRange: null,
  productTags: [],
  productTagsEn: [],
  blurb: null,
  blurbEn: null,
  imageAlts: [],
  submittedAt: '2024-01-01',
  approvedAt: null,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
}

const categories = [
  { slug: 'fashion', name: 'Fashion & Apparel', nameZh: '服飾鞋履' },
  { slug: 'home', name: 'Home & Living', nameZh: '居家生活' },
]

describe('FilterableBrandShowcase', () => {
  it('shows brands matching the selected product category', async () => {
    const user = userEvent.setup()
    const brands: Brand[] = [
      { ...baseBrand, id: 'fashion-brand', slug: 'fashion-brand', name: 'Fashion brand' },
      {
        ...baseBrand,
        id: 'home-brand',
        slug: 'home-brand',
        name: 'Home brand',
        category: '居家生活',
        productType: 'home',
      },
    ]

    render(<FilterableBrandShowcase brands={brands} categories={categories} />)

    await user.click(screen.getByRole('button', { name: /^服飾鞋履$/ }))

    expect(screen.getByRole('link', { name: 'Fashion brand' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Home brand' })).not.toBeInTheDocument()
  })
})
