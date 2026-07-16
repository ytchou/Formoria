// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
vi.mock('@/components/submit/TurnstileWidget', () => ({
  TurnstileWidget: ({ onSuccess }: { onSuccess: (token: string) => void }) => (
    <button data-testid='turnstile' onClick={() => onSuccess('mock-token')}>Turnstile</button>
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
  it('renders step 1 (Basic Info) by default', async () => {
    const { default: SubmissionWizard } = await import('../SubmissionWizard')
    render(
      <NextIntlClientProvider locale='zh-TW' messages={zhMessages}>
        <SubmissionWizard />
      </NextIntlClientProvider>
    )
    expect(screen.getByLabelText(/品牌名稱/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/網站/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/簡介/i)).toBeInTheDocument()
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
})
