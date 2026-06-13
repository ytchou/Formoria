// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import zhMessages from '../../../../messages/zh-TW.json'
import { BrandInfoStep } from '../BrandInfoStep'
import type { SubmissionFormData } from '@/lib/validations/submission'
import type { TaxonomyTag } from '@/lib/types/taxonomy'

vi.mock('../../upload/ImageUploader', () => ({
  ImageUploader: ({ onUpload }: { onUpload: (url: string) => void }) => (
    <button type="button" onClick={() => onUpload('https://example.com/logo.webp')}>
      Upload Logo
    </button>
  ),
}))

function Wrapper({ children }: { children: ReactNode }) {
  const methods = useForm<SubmissionFormData>({
    defaultValues: {
      name: '',
      description: '',
      category: '',
      region: '',
      valueTags: [],
      logoUrl: '',
      productTypes: [],
      productTypeNote: '',
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
    createdAt: '2026-01-01T00:00:00Z',
  },
]

function renderBrandInfoStep() {
  return render(
    <Wrapper>
      <BrandInfoStep
        categories={mockCategories}
        regionTags={mockRegionTags}
        valueTags={mockValueTags}
        uploadPath="brands/test-uuid"
      />
    </Wrapper>
  )
}

describe('BrandInfoStep product types', () => {
  it('renders at least 10 product type checkboxes with expected labels', () => {
    renderBrandInfoStep()

    const productTypeGroup = screen.getByRole('group', { name: '產品類型' })

    expect(within(productTypeGroup).getAllByRole('checkbox').length).toBeGreaterThanOrEqual(10)
    expect(screen.getByText('服飾鞋履')).toBeInTheDocument()
    expect(screen.getByText('母嬰寵物')).toBeInTheDocument()
  })

  it('shows the free-text mode toggle as a switch', () => {
    renderBrandInfoStep()

    expect(screen.getByRole('switch', { name: /以上都不適合？/ })).toBeInTheDocument()
  })

  it('hides the product type textarea by default', () => {
    renderBrandInfoStep()

    expect(screen.queryByPlaceholderText(/手工皮件/)).toBeNull()
  })

  it('reveals the product type textarea after clicking the toggle', async () => {
    const user = userEvent.setup()
    renderBrandInfoStep()

    await user.click(screen.getByRole('switch', { name: /以上都不適合？/ }))

    expect(screen.getByText('請描述你的產品類型')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/手工皮件/)).toBeInTheDocument()
  })

  it('disables all product type checkboxes after clicking the toggle', async () => {
    const user = userEvent.setup()
    renderBrandInfoStep()

    const productTypeGroup = screen.getByRole('group', { name: '產品類型' })
    const checkboxes = within(productTypeGroup).getAllByRole('checkbox')
    await user.click(screen.getByRole('switch', { name: /以上都不適合？/ }))

    checkboxes.forEach((checkbox) => {
      expect(checkbox).toHaveAttribute('aria-disabled', 'true')
    })
  })
})
