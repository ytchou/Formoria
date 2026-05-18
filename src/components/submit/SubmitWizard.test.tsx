// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
vi.mock('@/app/submit/actions', () => ({
  submitBrand: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}))

const mockCategories = [
  { slug: 'fashion', label: 'Fashion', labelZh: '時尚' },
]

describe('SubmitWizard', () => {
  it('renders step indicator and first step by default', () => {
    render(<SubmitWizard categories={mockCategories} />)
    expect(screen.getByTestId('step-indicator')).toHaveTextContent('Step 1')
    expect(screen.getByTestId('brand-info-step')).toBeInTheDocument()
  })

  it('shows Next button on step 1', () => {
    render(<SubmitWizard categories={mockCategories} />)
    expect(
      screen.getByRole('button', { name: /next/i })
    ).toBeInTheDocument()
  })

  it('does not show Back button on step 1', () => {
    render(<SubmitWizard categories={mockCategories} />)
    expect(
      screen.queryByRole('button', { name: /back/i })
    ).not.toBeInTheDocument()
  })
})
