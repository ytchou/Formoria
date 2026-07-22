// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/../messages/en.json'
import zhMessages from '@/../messages/zh-TW.json'
import type { UseFormReturn } from 'react-hook-form'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'
import type { Brand } from '@/lib/types'
import { BrandEditWizard } from '../brand-edit-wizard'

vi.mock('@/lib/actions/brand-edit-wizard', () => ({
  saveSectionDraftAction: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('@/app/[locale]/(protected)/dashboard/brands/[slug]/actions', () => ({
  updateBrandAction: vi.fn().mockResolvedValue({ success: true }),
  saveDraftAction: vi.fn().mockResolvedValue({ success: true }),
  publishDraftAction: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard/brands/test-brand/edit',
}))
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, className }: React.ComponentProps<'a'>) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

// Mock all 9 section components for isolation
vi.mock('../sections/basic-info-section', () => ({
  BasicInfoSection: ({
    form,
  }: {
    form: UseFormReturn<BrandEditFormValues>
  }) => (
    <div data-testid="basic-info-section">
      <input aria-label="Brand name field" {...form.register('name')} />
    </div>
  ),
}))
vi.mock('../sections/media-section', () => ({
  MediaSection: () => <div data-testid="media-section" />,
}))
vi.mock('../sections/links-section', () => ({
  LinksSection: ({ form }: { form: UseFormReturn<BrandEditFormValues> }) => (
    <div data-testid="links-section">
      <input
        aria-label="Official website"
        aria-invalid={Boolean(form.formState.errors.purchaseWebsite)}
        {...form.register('purchaseWebsite')}
      />
    </div>
  ),
}))
vi.mock('../sections/locations-section', () => ({
  LocationsSection: ({ isActualOwner }: { isActualOwner?: boolean }) => (
    <div
      data-testid="locations-section"
      data-actual-owner={String(isActualOwner)}
    />
  ),
}))
vi.mock('../sections/reputation-section', () => ({
  ReputationSection: ({
    form,
  }: {
    form: UseFormReturn<BrandEditFormValues>
  }) => (
    <div data-testid="reputation-section">
      <textarea
        aria-label="Reputation summary"
        {...form.register('reputationSummary')}
      />
    </div>
  ),
}))

const mockBrand: Brand = {
  id: 'test-brand-id',
  slug: 'test-brand',
  name: 'Test Brand',
  productType: 'fashion',
} as Brand

function renderWizard(props = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BrandEditWizard
        brand={mockBrand}
        defaultValues={{ name: 'Test Brand', productType: 'fashion' }}
        initialStep={0}
        isActualOwner={false}
        {...props}
      />
    </NextIntlClientProvider>,
  )
}

describe('BrandEditWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the sidebar', () => {
    renderWizard()
    // Sidebar renders step buttons
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0)
  })

  it('localizes wizard navigation labels', () => {
    render(
      <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
        <BrandEditWizard
          brand={mockBrand}
          defaultValues={{ name: 'Test Brand', productType: 'fashion' }}
          initialStep={0}
          isActualOwner={false}
        />
      </NextIntlClientProvider>,
    )

    expect(screen.getAllByText('基本資料').length).toBeGreaterThanOrEqual(1)
    expect(
      screen.getAllByRole('progressbar', { name: '已完成 0／5 步' }),
    ).toHaveLength(2)
  })

  it('shows the active section content at step 0', () => {
    renderWizard({ initialStep: 0 })
    expect(screen.getByTestId('basic-info-section')).toBeInTheDocument()
    expect(screen.queryByTestId('media-section')).not.toBeInTheDocument()
  })

  it('starts at the correct step when initialStep is provided', () => {
    renderWizard({ initialStep: 2 })
    expect(screen.getByTestId('links-section')).toBeInTheDocument()
  })

  it.each([true, false])(
    'forwards actual-owner presentation state %s to the locations step',
    (isActualOwner) => {
      renderWizard({ initialStep: 3, isActualOwner })

      expect(screen.getByTestId('locations-section')).toHaveAttribute(
        'data-actual-owner',
        String(isActualOwner),
      )
    },
  )

  it('restores completed steps from saved progress metadata', () => {
    renderWizard({
      initialStep: 2,
      initialCompletedSteps: [0, 1],
    })

    const basicInfoButton = screen.getAllByRole('button', {
      name: 'Basic Info',
    })[0]
    expect(basicInfoButton.querySelector('svg')).toBeTruthy()
  })

  it('shows the persisted completion count when resuming at step 4', () => {
    renderWizard({
      initialStep: 3,
      initialCompletedSteps: [0, 1, 2],
    })

    expect(screen.getAllByText('3 of 5 completed').length).toBeGreaterThanOrEqual(1)
  })

  it('renders focused mode without the guided sidebar', () => {
    renderWizard({ initialStep: 2, isFocused: true })

    expect(screen.getByTestId('links-section')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Edit brand details' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save & continue/i })).not.toBeInTheDocument()
  })

  it('only shows unsaved changes for edits in the active section', async () => {
    renderWizard()

    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Brand name field' }),
      {
        target: { value: 'Changed Brand' },
      },
    )
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: /Brand images/ })[0])
    await waitFor(() => {
      expect(screen.getByTestId('media-section')).toBeInTheDocument()
      expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Basic Info' })[0])
    await waitFor(() => {
      expect(screen.getByTestId('basic-info-section')).toBeInTheDocument()
      expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
    })
  })

  it('navigates to the next section on Save & Continue', async () => {
    renderWizard({ initialStep: 0 })
    const btn = screen.getByRole('button', { name: /save & continue/i })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(screen.getByTestId('media-section')).toBeInTheDocument()
    })
  })

  it('calls saveSectionDraftAction on Save & Continue', async () => {
    const { saveSectionDraftAction } =
      await import('@/lib/actions/brand-edit-wizard')
    renderWizard({ initialStep: 0 })
    fireEvent.click(screen.getByRole('button', { name: /save & continue/i }))
    await waitFor(() => {
      expect(saveSectionDraftAction).toHaveBeenCalled()
    })
  })

  it('does not advance from Links without the required official website', async () => {
    const { saveSectionDraftAction } =
      await import('@/lib/actions/brand-edit-wizard')
    renderWizard({ initialStep: 2 })

    fireEvent.click(screen.getByRole('button', { name: /save & continue/i }))

    await waitFor(() => {
      expect(
        screen.getByRole('textbox', { name: 'Official website' }),
      ).toHaveAttribute('aria-invalid', 'true')
    })
    expect(screen.getByTestId('links-section')).toBeInTheDocument()
    expect(saveSectionDraftAction).not.toHaveBeenCalled()
  })

  it('navigates back on Back click', async () => {
    renderWizard({ initialStep: 1 })
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => {
      expect(screen.getByTestId('basic-info-section')).toBeInTheDocument()
    })
  })

  it('saves final-step edits before publishing', async () => {
    const { saveSectionDraftAction } =
      await import('@/lib/actions/brand-edit-wizard')
    const { publishDraftAction } =
      await import('@/app/[locale]/(protected)/dashboard/brands/[slug]/actions')
    renderWizard({
      initialStep: 4,
      defaultValues: {
        name: 'Warmwood Living',
        productType: 'home',
        description: 'Furniture made in Taiwan.',
        productTags: ['furniture'],
        priceRange: 2,
        heroImageUrl: 'https://example.com/hero.jpg',
        productPhotos: ['https://example.com/product.jpg'],
        purchaseWebsite: 'https://example.com',
      },
    })

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Reputation summary' }),
      {
        target: { value: 'Featured by independent design publications.' },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: /publish/i }))

    await waitFor(() => {
      expect(saveSectionDraftAction).toHaveBeenCalledWith(
        'test-brand-id',
        'test-brand',
        'reputation',
        expect.objectContaining({
          reputationSummary: 'Featured by independent design publications.',
        }),
      )
      expect(publishDraftAction).toHaveBeenCalled()
    })
    expect(
      vi.mocked(saveSectionDraftAction).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(publishDraftAction).mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('does not publish when saving final-step edits fails', async () => {
    const { saveSectionDraftAction } =
      await import('@/lib/actions/brand-edit-wizard')
    const { publishDraftAction } =
      await import('@/app/[locale]/(protected)/dashboard/brands/[slug]/actions')
    vi.mocked(saveSectionDraftAction).mockResolvedValueOnce({
      error: 'Unable to save reputation edits',
    })
    renderWizard({
      initialStep: 4,
      defaultValues: {
        name: 'Warmwood Living',
        productType: 'home',
        description: 'Furniture made in Taiwan.',
        productTags: ['furniture'],
        priceRange: 2,
        heroImageUrl: 'https://example.com/hero.jpg',
        productPhotos: ['https://example.com/product.jpg'],
        purchaseWebsite: 'https://example.com',
      },
    })

    fireEvent.click(screen.getByRole('button', { name: /publish/i }))

    await waitFor(() => {
      expect(saveSectionDraftAction).toHaveBeenCalled()
    })
    expect(publishDraftAction).not.toHaveBeenCalled()
  })
})
