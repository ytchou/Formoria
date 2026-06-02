// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSendGAEvent = vi.fn()
vi.mock('@next/third-parties/google', () => ({
  sendGAEvent: (...args: unknown[]) => mockSendGAEvent(...args),
}))
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import zhMessages from '../../../messages/zh-TW.json'
import { SubmitWizard } from './SubmitWizard'

vi.mock('./StepIndicator', () => ({
  StepIndicator: ({ currentStep }: { currentStep: number }) => (
    <div data-testid="step-indicator">Step {currentStep + 1}</div>
  ),
}))
vi.mock('./BrandInfoStep', () => ({
  BrandInfoStep: () => <div data-testid="brand-info-step">Brand Info</div>,
}))
vi.mock('./ProductsStep', () => ({
  ProductsStep: () => <div data-testid="products-step">Products</div>,
}))
vi.mock('./LinksStep', () => ({
  LinksStep: () => <div data-testid="links-step">Links</div>,
}))
vi.mock('./ReviewStep', () => ({
  ReviewStep: ({ onEditStep }: { onEditStep: (n: number) => void }) => (
    <div data-testid="review-step">
      Review
      <button onClick={() => onEditStep(0)}>Edit Brand Info</button>
    </div>
  ),
}))
vi.mock('./UrlStep', () => ({
  UrlStep: ({
    onSuccess,
    onSkip,
  }: {
    onSuccess: (data: Record<string, unknown>) => void
    onSkip: () => void
  }) => (
    <div data-testid="url-step">
      <label htmlFor="test-url">Website URL</label>
      <input id="test-url" />
      <button
        onClick={() =>
          onSuccess({
            brandName: 'Scraped Brand',
            description: 'From the web',
            heroImageUrl: null,
            galleryImageUrls: [],
            socialLinks: {
              instagram: 'https://instagram.com/test',
              threads: null,
              facebook: null,
            },
            categoryHints: [],
            websiteUrl: 'https://test.com',
            rawJsonLd: null,
          })
        }
      >
        Fetch Brand Info
      </button>
      <button onClick={onSkip}>Skip and fill manually</button>
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

describe('SubmitWizard', () => {
  it('renders step indicator and first step by default', () => {
    renderWithZhTW(<SubmitWizard categories={mockCategories} />)
    expect(screen.getByTestId('url-step')).toBeInTheDocument()
  })

  it('shows Next button is not visible on UrlStep', () => {
    renderWithZhTW(<SubmitWizard categories={mockCategories} />)
    expect(screen.queryByRole('button', { name: /^next$/i })).not.toBeInTheDocument()
  })
})

describe('SubmitWizard with UrlStep', () => {
  it('shows UrlStep as first step', () => {
    renderWithZhTW(<SubmitWizard categories={mockCategories} />)

    expect(screen.getByText(/提交品牌/)).toBeInTheDocument()
    expect(screen.getByTestId('url-step')).toBeInTheDocument()
  })

  it('transitions to BrandInfoStep after skip', async () => {
    const user = userEvent.setup()
    renderWithZhTW(<SubmitWizard categories={mockCategories} />)

    await user.click(screen.getByText(/skip and fill manually/i))

    await waitFor(() => {
      expect(screen.getByTestId('brand-info-step')).toBeInTheDocument()
    })
  })

  it('transitions to BrandInfoStep after successful scrape', async () => {
    const user = userEvent.setup()
    renderWithZhTW(<SubmitWizard categories={mockCategories} />)

    await user.click(screen.getByRole('button', { name: /fetch brand info/i }))

    await waitFor(() => {
      expect(screen.getByTestId('brand-info-step')).toBeInTheDocument()
    })
  })
})

describe('SubmitWizard — analytics', () => {
  beforeEach(() => {
    mockSendGAEvent.mockClear()
  })

  it('fires submission_form_opened with source on mount', () => {
    renderWithZhTW(<SubmitWizard categories={mockCategories} source="hero_cta" />)
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'submission_form_opened', {
      source: 'hero_cta',
    })
  })

  it('fires submission_form_opened with default source when none provided', () => {
    renderWithZhTW(<SubmitWizard categories={mockCategories} />)
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'submission_form_opened', {
      source: 'hero_cta',
    })
  })
})
