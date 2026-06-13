// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import zhMessages from '../../../../messages/zh-TW.json'
import { SubmitWizard } from '../SubmitWizard'

vi.mock('@next/third-parties/google', () => ({
  sendGAEvent: vi.fn(),
}))
vi.mock('../StepIndicator', () => ({
  StepIndicator: ({ currentStep }: { currentStep: number }) => (
    <div data-testid="step-indicator">Step {currentStep + 1}</div>
  ),
}))
vi.mock('../BrandInfoStep', async () => {
  const { useFormContext } = await import('react-hook-form')

  return {
    BrandInfoStep: () => {
      const { getValues } = useFormContext()

      if (!Array.isArray(getValues('productTypes'))) {
        throw new Error('productTypes default value is required')
      }

      if (getValues('productTypeNote') !== '') {
        throw new Error('productTypeNote default value is required')
      }

      return <div data-testid="brand-info-step">Brand Info</div>
    },
  }
})
vi.mock('../ProductsStep', () => ({
  ProductsStep: () => <div data-testid="products-step">Products</div>,
}))
vi.mock('../LinksStep', () => ({
  LinksStep: () => <div data-testid="links-step">Links</div>,
}))
vi.mock('../ReviewStep', () => ({
  ReviewStep: () => <div data-testid="review-step">Review</div>,
}))
vi.mock('../UrlStep', () => ({
  UrlStep: ({ onSkip }: { onSkip: (links: Record<string, unknown>) => void }) => (
    <div data-testid="url-step">
      <button
        onClick={() =>
          onSkip({
            websiteUrl: '',
            instagram: '',
            threads: '',
            facebook: '',
            purchaseLinks: [],
          })
        }
      >
        Skip and fill manually
      </button>
    </div>
  ),
}))
vi.mock('@/app/[locale]/submit/actions', () => ({
  submitBrand: vi.fn(),
}))
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}))

const mockCategories = [
  { slug: 'fashion', label: 'Fashion', labelZh: '時尚' },
]

function renderWithZhTW(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('SubmitWizard product type defaults', () => {
  it('mounts the form when productTypes and productTypeNote are in defaultValues', async () => {
    const user = userEvent.setup()
    const { container } = renderWithZhTW(<SubmitWizard categories={mockCategories} />)

    await user.click(screen.getByText(/skip and fill manually/i))

    expect(container.querySelector('form')).toBeTruthy()
  })
})
