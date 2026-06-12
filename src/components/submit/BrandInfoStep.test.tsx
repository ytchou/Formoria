// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import { NextIntlClientProvider } from 'next-intl'
import zhMessages from '../../../messages/zh-TW.json'
import { BrandInfoStep } from './BrandInfoStep'
import type { PhotoItem } from '@/lib/types/scraper'
import type { TaxonomyTag } from '@/lib/types/taxonomy'

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
      region: '',
      valueTags: [] as string[],
      logoUrl: '',
      brandHighlights: '',
    },
  })
  return (
    <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
      <FormProvider {...methods}>{children}</FormProvider>
    </NextIntlClientProvider>
  )
}

const mockCategories = [
  { slug: 'fashion', label: 'Fashion', labelZh: '時尚' },
  { slug: 'home', label: 'Lifestyle & Home', labelZh: '居家生活' },
]

const mockRegionTags: TaxonomyTag[] = [
  {
    id: 'region-1',
    name: 'Taipei',
    nameZh: '台北',
    slug: 'taipei',
    category: 'region',
    isActive: true,
    suggestedBy: null,
    createdAt: '2026-01-01T00:00:00Z',
  },
]

const mockValueTags: TaxonomyTag[] = [
  {
    id: 'value-1',
    name: 'Sustainable',
    nameZh: '永續',
    slug: 'sustainable',
    category: 'value',
    isActive: true,
    suggestedBy: null,
    createdAt: '2026-01-01T00:00:00Z',
  },
]

describe('BrandInfoStep', () => {
  it('renders all form fields', () => {
    render(
      <Wrapper>
        <BrandInfoStep
          categories={mockCategories}
          regionTags={mockRegionTags}
          valueTags={mockValueTags}
          uploadPath="brands/test-uuid"
        />
      </Wrapper>
    )
    // Labels are zh-TW: 品牌名稱, 品牌描述, 類別, Logo（可選）
    expect(screen.getByLabelText(/品牌名稱/)).toBeInTheDocument()
    expect(screen.getByLabelText(/品牌描述/)).toBeInTheDocument()
    expect(screen.getByLabelText(/類別/)).toBeInTheDocument()
    expect(screen.getByText(/Logo（可選）|Logo \*/)).toBeInTheDocument()
  })

  it('allows typing in name and description fields', async () => {
    const user = userEvent.setup()
    render(
      <Wrapper>
        <BrandInfoStep
          categories={mockCategories}
          regionTags={mockRegionTags}
          valueTags={mockValueTags}
          uploadPath="brands/test-uuid"
        />
      </Wrapper>
    )

    const nameInput = screen.getByLabelText(/品牌名稱/)
    await user.type(nameInput, '雨靴工作室')
    expect(nameInput).toHaveValue('雨靴工作室')
  })

  it('shows character count for description', () => {
    render(
      <Wrapper>
        <BrandInfoStep
          categories={mockCategories}
          regionTags={mockRegionTags}
          valueTags={mockValueTags}
          uploadPath="brands/test-uuid"
        />
      </Wrapper>
    )
    // charCount in zh-TW: "{count} / {max} 個字元上限"
    expect(screen.getByText(/0.*\/.*2000.*個字元/)).toBeInTheDocument()
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
          regionTags={mockRegionTags}
          valueTags={mockValueTags}
          uploadPath="brands/test-uuid"
          photos={scrapedPhotos}
          onPhotosChange={vi.fn()}
        />
      </Wrapper>
    )

    expect(screen.getByText('Hero')).toBeInTheDocument()
    // fromWebsite = "來自網站", uploaded = "已上傳" in zh-TW
    expect(screen.getAllByText('來自網站')).toHaveLength(2)
    expect(screen.getByText('已上傳')).toBeInTheDocument()
  })

  it('shows Hero badge on first image only', () => {
    render(
      <Wrapper>
        <BrandInfoStep
          categories={mockCategories}
          regionTags={mockRegionTags}
          valueTags={mockValueTags}
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
          regionTags={mockRegionTags}
          valueTags={mockValueTags}
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
          regionTags={mockRegionTags}
          valueTags={mockValueTags}
          uploadPath="brands/test-uuid"
          photos={[]}
          onPhotosChange={vi.fn()}
        />
      </Wrapper>
    )

    // noPhotos = "未從您的網站找到照片", addPhotos = "新增照片" in zh-TW
    expect(screen.getByText(/未從您的網站找到照片/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /新增照片/ })
    ).toBeInTheDocument()
  })

  it('shows add more button below photo grid', () => {
    render(
      <Wrapper>
        <BrandInfoStep
          categories={mockCategories}
          regionTags={mockRegionTags}
          valueTags={mockValueTags}
          uploadPath="brands/test-uuid"
          photos={scrapedPhotos}
          onPhotosChange={vi.fn()}
        />
      </Wrapper>
    )

    // addMorePhotos = "新增更多照片" in zh-TW
    expect(
      screen.getByRole('button', { name: /新增更多照片/ })
    ).toBeInTheDocument()
  })
})
