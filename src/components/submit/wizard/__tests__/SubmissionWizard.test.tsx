// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import zhMessages from '../../../../../messages/zh-TW.json'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/app/[locale]/submit/actions', () => ({
  submitOwnerDetailedBrand: vi.fn(),
  suggestCleanName: vi.fn().mockResolvedValue({ changed: false }),
}))
vi.mock('@/lib/actions/location-search', () => ({
  searchLocationAction: vi.fn().mockResolvedValue({ success: true, results: [] }),
}))
vi.mock('@/components/brand-wizard/locations-section', async () => {
  const { useFormContext, useWatch } = await import('react-hook-form')

  function MockBrandLocationsSection({
    isActualOwner,
    preserveOwnerConfirmation,
  }: {
    isActualOwner?: boolean
    preserveOwnerConfirmation?: boolean
  }) {
    const form = useFormContext()
    const retailLocations = useWatch({
      control: form.control,
      name: 'retailLocations',
    })

    return (
      <div
        data-testid='brand-locations-section'
        data-actual-owner={String(isActualOwner)}
        data-preserve-owner-confirmation={String(preserveOwnerConfirmation)}
      >
        <button
          type='button'
          onClick={() => {
            form.setValue('heroImageUrl', 'https://warmwood.example/hero.jpg')
            form.setValue('retailLocations', [
              {
                kind: 'location',
                name: 'Warmwood Xinyi',
                relationshipType: 'brand_store',
                address: 'No. 1 Xinyi Road, Taipei',
                availabilityNote: 'Weekend stock only.',
                confirmationStatus: 'owner_confirmed',
              },
            ])
          }}
        >
          Inject owner confirmation
        </button>
        <output data-testid='submission-location-values'>
          {JSON.stringify(retailLocations ?? [])}
        </output>
      </div>
    )
  }

  return { BrandLocationsSection: MockBrandLocationsSection }
})
vi.mock('@/components/submit/TurnstileWidget', () => ({
  TurnstileWidget: ({ onSuccess }: { onSuccess: (token: string) => void }) => (
    <button type='button' data-testid='turnstile' onClick={() => onSuccess('mock-token')}>Turnstile</button>
  ),
}))
vi.mock('@/components/forms/image-upload-field', () => ({
  ImageUploadField: () => <div data-testid='image-upload'>Image Upload</div>,
}))
vi.mock('@/components/forms/product-photos-field', () => ({
  ProductPhotosField: () => <div data-testid='product-photos'>Product Photos</div>,
}))
vi.mock('@/components/forms/product-tag-field', () => ({
  ProductTagField: () => <div data-testid='product-tags'>Product Tags</div>,
}))

describe('SubmissionWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders step 1 (Basic Info) by default', async () => {
    const { default: SubmissionWizard } = await import('../SubmissionWizard')
    render(
      <NextIntlClientProvider locale='zh-TW' messages={zhMessages}>
        <SubmissionWizard />
      </NextIntlClientProvider>
    )
    expect(screen.getByLabelText(/品牌名稱/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/品牌英文名稱/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/網站/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/品牌介紹/i)).toBeInTheDocument()
  })

  it('renders wizard sidebar with 4 steps', async () => {
    const { default: SubmissionWizard } = await import('../SubmissionWizard')
    render(
      <NextIntlClientProvider locale='zh-TW' messages={zhMessages}>
        <SubmissionWizard />
      </NextIntlClientProvider>
    )
    expect(screen.getAllByText(/1.*4/).length).toBeGreaterThanOrEqual(1)
  })

  it('does not submit while navigating between wizard steps', async () => {
    const { submitOwnerDetailedBrand } = await import('@/app/[locale]/submit/actions')
    const { default: SubmissionWizard } = await import('../SubmissionWizard')
    render(
      <NextIntlClientProvider locale='zh-TW' messages={zhMessages}>
        <SubmissionWizard />
      </NextIntlClientProvider>
    )

    fireEvent.change(screen.getByLabelText(/品牌名稱/i), {
      target: { value: '暖木生活' },
    })
    fireEvent.change(screen.getByLabelText(/網站/i), {
      target: { value: 'https://warmwood.example' },
    })
    fireEvent.change(screen.getByLabelText(/品牌介紹/i), {
      target: { value: '台灣居家生活品牌' },
    })
    fireEvent.click(screen.getByRole('button', { name: /儲存並繼續/i }))

    await waitFor(() => {
      expect(screen.getByText('產品圖片')).toBeInTheDocument()
    })
    expect(submitOwnerDetailedBrand).not.toHaveBeenCalled()
  })

  it('renders submission locations without owner confirmation capability', async () => {
    const { default: SubmissionWizard } = await import('../SubmissionWizard')
    render(
      <NextIntlClientProvider locale='zh-TW' messages={zhMessages}>
        <SubmissionWizard />
      </NextIntlClientProvider>
    )

    fireEvent.change(screen.getByLabelText(/品牌名稱/i), {
      target: { value: '暖木生活' },
    })
    fireEvent.change(screen.getByLabelText(/網站/i), {
      target: { value: 'https://warmwood.example' },
    })
    fireEvent.change(screen.getByLabelText(/品牌介紹/i), {
      target: { value: '台灣居家生活品牌' },
    })
    fireEvent.click(
      screen.getAllByRole('button', { name: /販售地點/ })[0],
    )

    await waitFor(() => {
      expect(screen.getByTestId('brand-locations-section')).toHaveAttribute(
        'data-actual-owner',
        'false',
      )
      expect(screen.getByTestId('brand-locations-section')).toHaveAttribute(
        'data-preserve-owner-confirmation',
        'false',
      )
    })
  })

  it('sanitizes an elevating location value before submission', async () => {
    const { submitOwnerDetailedBrand } = await import('@/app/[locale]/submit/actions')
    const { default: SubmissionWizard } = await import('../SubmissionWizard')
    render(
      <NextIntlClientProvider locale='zh-TW' messages={zhMessages}>
        <SubmissionWizard />
      </NextIntlClientProvider>
    )

    fireEvent.change(screen.getByLabelText(/品牌名稱/i), {
      target: { value: '暖木生活' },
    })
    fireEvent.change(screen.getByLabelText(/網站/i), {
      target: { value: 'https://warmwood.example' },
    })
    fireEvent.change(screen.getByLabelText(/品牌介紹/i), {
      target: { value: '台灣居家生活品牌' },
    })
    fireEvent.click(
      screen.getAllByRole('button', { name: /販售地點/ })[0],
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Inject owner confirmation' }),
    )

    await waitFor(() => {
      expect(screen.getByTestId('submission-location-values')).toHaveTextContent(
        '"confirmationStatus":"unconfirmed"',
      )
      expect(screen.getByTestId('submission-location-values')).toHaveTextContent(
        '"availabilityNote":"Weekend stock only."',
      )
    })

    fireEvent.click(
      screen.getAllByRole('button', { name: /社群與購買連結/ })[0],
    )
    await waitFor(() => {
      expect(
        screen.queryByTestId('submission-location-values'),
      ).not.toBeInTheDocument()
    })
    fireEvent.click(
      screen.getAllByRole('button', { name: /販售地點/ })[0],
    )
    await waitFor(() => {
      expect(screen.getByTestId('submission-location-values')).toHaveTextContent(
        '"availabilityNote":"Weekend stock only."',
      )
    })

    fireEvent.click(screen.getByRole('checkbox', { name: /我同意依據/ }))
    fireEvent.click(screen.getByTestId('turnstile'))
    fireEvent.click(screen.getByRole('button', { name: '提交品牌資料' }))

    await waitFor(() => {
      expect(submitOwnerDetailedBrand).toHaveBeenCalledWith(
        expect.objectContaining({
          retailLocations: [
            expect.objectContaining({
              availabilityNote: 'Weekend stock only.',
              confirmationStatus: 'unconfirmed',
            }),
          ],
        }),
      )
    })
  })
})
