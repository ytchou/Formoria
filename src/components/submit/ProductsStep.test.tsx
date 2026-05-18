// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import { ProductsStep } from './ProductsStep'

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
    defaultValues: { productPhotos: [] as string[], productHighlights: '' },
  })
  return <FormProvider {...methods}>{children}</FormProvider>
}

describe('ProductsStep', () => {
  it('renders photo uploader and highlights field', () => {
    render(
      <Wrapper>
        <ProductsStep uploadPath="brands/test-uuid/photos" />
      </Wrapper>
    )
    expect(screen.getByTestId('photo-uploader')).toBeInTheDocument()
    expect(screen.getByLabelText(/product highlights/i)).toBeInTheDocument()
  })

  it('allows typing in highlights field', async () => {
    const user = userEvent.setup()
    render(
      <Wrapper>
        <ProductsStep uploadPath="brands/test-uuid/photos" />
      </Wrapper>
    )
    const textarea = screen.getByLabelText(/product highlights/i)
    await user.type(textarea, 'Handcrafted cedar')
    expect(textarea).toHaveValue('Handcrafted cedar')
  })
})
