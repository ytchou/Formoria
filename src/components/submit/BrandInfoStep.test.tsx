// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import { BrandInfoStep } from './BrandInfoStep'

vi.mock('../upload/ImageUploader', () => ({
  ImageUploader: ({ onUpload }: { onUpload: (url: string) => void }) => (
    <button onClick={() => onUpload('https://example.com/logo.webp')}>
      Upload Logo
    </button>
  ),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const methods = useForm({
    defaultValues: {
      name: '',
      description: '',
      category: '',
      tags: [] as string[],
      logoUrl: '',
    },
  })
  return <FormProvider {...methods}>{children}</FormProvider>
}

const mockCategories = [
  { slug: 'fashion', label: 'Fashion', labelZh: '時尚' },
  { slug: 'home', label: 'Lifestyle & Home', labelZh: '居家生活' },
]

describe('BrandInfoStep', () => {
  it('renders all form fields', () => {
    render(
      <Wrapper>
        <BrandInfoStep
          categories={mockCategories}
          uploadPath="brands/test-uuid"
        />
      </Wrapper>
    )
    expect(screen.getByLabelText(/brand name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/brand description/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/category/i)).toBeInTheDocument()
    expect(screen.getByText('Brand Logo')).toBeInTheDocument()
  })

  it('allows typing in name and description fields', async () => {
    const user = userEvent.setup()
    render(
      <Wrapper>
        <BrandInfoStep
          categories={mockCategories}
          uploadPath="brands/test-uuid"
        />
      </Wrapper>
    )

    const nameInput = screen.getByLabelText(/brand name/i)
    await user.type(nameInput, '雨靴工作室')
    expect(nameInput).toHaveValue('雨靴工作室')
  })

  it('shows character count for description', () => {
    render(
      <Wrapper>
        <BrandInfoStep
          categories={mockCategories}
          uploadPath="brands/test-uuid"
        />
      </Wrapper>
    )
    expect(screen.getByText(/0.*\/.*500.*max.*characters/i)).toBeInTheDocument()
  })
})
