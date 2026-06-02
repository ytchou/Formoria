// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import { NextIntlClientProvider } from 'next-intl'
import zhMessages from '../../../messages/zh-TW.json'
import { ProductsStep } from './ProductsStep'

function renderWithZhTW(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

vi.mock('../upload/ImageUploader', () => ({
  ImageUploader: ({
    onUpload,
    onRemove,
    value,
  }: {
    onUpload: (url: string) => void
    onRemove?: (index: number) => void
    value?: string[]
  }) => (
    <div data-testid="photo-uploader">
      <span>{(value || []).length} photos</span>
      <button onClick={() => onUpload('https://example.com/new.webp')}>
        Add Photo
      </button>
      {(value || []).map((_: string, i: number) => (
        <button
          key={i}
          onClick={() => onRemove?.(i)}
          aria-label={`Remove photo ${i + 1}`}
        >
          x
        </button>
      ))}
    </div>
  ),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const methods = useForm({
    defaultValues: { productPhotos: [] as string[], brandHighlights: '' },
  })
  return <FormProvider {...methods}>{children}</FormProvider>
}

describe('ProductsStep', () => {
  it('renders photo uploader and highlights field', () => {
    renderWithZhTW(
      <Wrapper>
        <ProductsStep uploadPath="brands/test-uuid/photos" />
      </Wrapper>
    )
    expect(screen.getByTestId('photo-uploader')).toBeInTheDocument()
    // brandHighlights = "品牌亮點"
    expect(screen.getByLabelText('品牌亮點')).toBeInTheDocument()
  })

  it('allows typing in highlights field', async () => {
    const user = userEvent.setup()
    renderWithZhTW(
      <Wrapper>
        <ProductsStep uploadPath="brands/test-uuid/photos" />
      </Wrapper>
    )
    // brandHighlights = "品牌亮點"
    const textarea = screen.getByLabelText('品牌亮點')
    await user.type(textarea, 'Handcrafted cedar')
    expect(textarea).toHaveValue('Handcrafted cedar')
  })
})
