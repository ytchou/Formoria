// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { Brand } from '@/lib/types'
import { BrandEditWizard } from '../brand-edit-wizard'

vi.mock('@/lib/actions/brand-edit-wizard', () => ({
  saveSectionDraftAction: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('@/app/[locale]/(protected)/dashboard/brands/[slug]/actions', () => ({
  publishDraftAction: vi.fn().mockResolvedValue({
    violations: [
      {
        field: 'description',
        rule: 'spam',
        userMessage: 'Remove promotional language.',
      },
    ],
  }),
}))
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

vi.mock('../sections/basic-info-section', () => ({
  BasicInfoSection: () => <div data-testid="basic-info-section" />,
}))
vi.mock('../sections/media-section', () => ({
  MediaSection: () => <div data-testid="media-section" />,
}))
vi.mock('../sections/links-section', () => ({
  LinksSection: () => <div data-testid="links-section" />,
}))
vi.mock('../sections/locations-section', () => ({
  LocationsSection: () => <div data-testid="locations-section" />,
}))
vi.mock('../sections/reputation-section', () => ({
  ReputationSection: () => <div data-testid="reputation-section" />,
}))

const mockBrand = {
  id: 'test-brand-id',
  slug: 'test-brand',
  name: 'Test Brand',
  productType: 'fashion',
} as Brand

describe('BrandEditWizard publish violations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows field errors and a summary toast when publishing is rejected', async () => {
    render(
      <BrandEditWizard
        brand={mockBrand}
        initialStep={4}
        defaultValues={{
          name: 'Warmwood Living',
          productType: 'home',
          description: 'Furniture made in Taiwan.',
          productTags: ['furniture'],
          priceRange: 2,
          heroImageUrl: 'https://example.com/hero.jpg',
          productPhotos: ['https://example.com/product.jpg'],
          purchaseWebsite: 'https://example.com',
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'wizardPublish' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('violationSummary')
    })
    expect(screen.getByTestId('basic-info-section')).toBeInTheDocument()
  })
})
