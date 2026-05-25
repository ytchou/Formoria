// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import { BrandInfoStep } from './BrandInfoStep'
import type { PhotoItem } from '@/lib/types/scraper'

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
    expect(screen.getByText(/logo（可選）|logo \*/i)).toBeInTheDocument()
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

describe('BrandInfoStep photo gallery', () => {
  const scrapedPhotos: PhotoItem[] = [
    { id: '1', url: 'https://example.com/photo1.jpg', source: 'scraped' },
    { id: '2', url: 'https://example.com/photo2.jpg', source: 'scraped' },
    { id: '3', url: 'https://example.com/photo3.jpg', source: 'uploaded' },
  ]

  it('renders scraped images with correct badges', () => {
    render(
      <Wrapper>
        <BrandInfoStep
          categories={mockCategories}
          uploadPath="brands/test-uuid"
          photos={scrapedPhotos}
          onPhotosChange={vi.fn()}
        />
      </Wrapper>
    )

    expect(screen.getByText('Hero')).toBeInTheDocument()
    expect(screen.getAllByText('from website')).toHaveLength(2)
    expect(screen.getByText('uploaded')).toBeInTheDocument()
  })

  it('shows Hero badge on first image only', () => {
    render(
      <Wrapper>
        <BrandInfoStep
          categories={mockCategories}
          uploadPath="brands/test-uuid"
          photos={scrapedPhotos}
          onPhotosChange={vi.fn()}
        />
      </Wrapper>
    )

    const heroElements = screen.getAllByText('Hero')
    expect(heroElements).toHaveLength(1)
  })

  it('removes photo when X button is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <Wrapper>
        <BrandInfoStep
          categories={mockCategories}
          uploadPath="brands/test-uuid"
          photos={scrapedPhotos}
          onPhotosChange={onChange}
        />
      </Wrapper>
    )

    const removeButtons = screen.getAllByRole('button', { name: /remove/i })
    await user.click(removeButtons[0])

    expect(onChange).toHaveBeenCalledWith(
      expect.not.arrayContaining([expect.objectContaining({ id: '1' })])
    )
  })

  it('shows empty state when no photos', () => {
    render(
      <Wrapper>
        <BrandInfoStep
          categories={mockCategories}
          uploadPath="brands/test-uuid"
          photos={[]}
          onPhotosChange={vi.fn()}
        />
      </Wrapper>
    )

    expect(screen.getByText(/no photos found/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /add.*photos/i })
    ).toBeInTheDocument()
  })

  it('shows add more button below photo grid', () => {
    render(
      <Wrapper>
        <BrandInfoStep
          categories={mockCategories}
          uploadPath="brands/test-uuid"
          photos={scrapedPhotos}
          onPhotosChange={vi.fn()}
        />
      </Wrapper>
    )

    expect(
      screen.getByRole('button', { name: /add more photos/i })
    ).toBeInTheDocument()
  })
})
