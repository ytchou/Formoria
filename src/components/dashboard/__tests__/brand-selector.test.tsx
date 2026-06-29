// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/../messages/en.json'
import { BrandSelector } from '../brand-selector'

const mockReplace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams('brand=brand-a'),
  usePathname: () => '/dashboard',
}))

const brands = [
  {
    brandId: '1',
    brandName: 'Brand A',
    brandSlug: 'brand-a',
    heroImageUrl: null,
    claimedAt: '2026-01-01',
  },
  {
    brandId: '2',
    brandName: 'Brand B',
    brandSlug: 'brand-b',
    heroImageUrl: null,
    claimedAt: '2026-01-02',
  },
]

describe('BrandSelector', () => {
  it('renders selected brand name', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <BrandSelector brands={brands} selectedSlug="brand-a" />
      </NextIntlClientProvider>
    )
    expect(screen.getByText('Brand A')).toBeInTheDocument()
  })

  it('renders static heading when only one brand', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <BrandSelector brands={[brands[0]]} selectedSlug="brand-a" />
      </NextIntlClientProvider>
    )
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText('Brand A')).toBeInTheDocument()
  })

  it('renders select trigger when multiple brands', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <BrandSelector brands={brands} selectedSlug="brand-a" />
      </NextIntlClientProvider>
    )
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })
})
