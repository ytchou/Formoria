// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() })),
  usePathname: vi.fn(() => '/'),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}))

vi.mock('@/lib/services/taxonomy', () => ({
  getUntaggedBrands: vi.fn(),
  getTags: vi.fn(),
}))

vi.mock('@/lib/services/brands', () => ({
  getBrands: vi.fn(),
}))

describe('Admin brands page', () => {
  it('renders an Untagged Brands section when untagged brands exist', async () => {
    const { getUntaggedBrands, getTags } = await import('@/lib/services/taxonomy')
    const { getBrands } = await import('@/lib/services/brands')

    vi.mocked(getUntaggedBrands).mockResolvedValue([
      { id: 'b1', name: 'Untagged Brand', slug: 'untagged-brand', category: 'Fashion' },
    ])
    vi.mocked(getTags).mockResolvedValue([])
    vi.mocked(getBrands).mockResolvedValue({ brands: [], totalCount: 0 })

    const BrandsPage = (await import('../page')).default
    render(await BrandsPage())

    expect(screen.getByRole('heading', { name: /untagged brands/i })).toBeInTheDocument()
    expect(screen.getByText('Untagged Brand')).toBeInTheDocument()
  })

  it('does not render Untagged Brands section when all brands are tagged', async () => {
    const { getUntaggedBrands, getTags } = await import('@/lib/services/taxonomy')
    const { getBrands } = await import('@/lib/services/brands')

    vi.mocked(getUntaggedBrands).mockResolvedValue([])
    vi.mocked(getTags).mockResolvedValue([])
    vi.mocked(getBrands).mockResolvedValue({ brands: [], totalCount: 0 })

    const BrandsPage = (await import('../page')).default
    render(await BrandsPage())

    expect(screen.queryByRole('heading', { name: /untagged brands/i })).not.toBeInTheDocument()
  })
})
