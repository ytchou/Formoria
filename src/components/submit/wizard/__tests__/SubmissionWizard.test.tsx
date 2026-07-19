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
})
