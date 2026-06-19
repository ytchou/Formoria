// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
      productType: '',
      productTypeNote: '',
    },
  })

  return (
    <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
      <FormProvider {...methods}>{children}</FormProvider>
    </NextIntlClientProvider>
  )
}

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

function renderBrandInfoStep() {
  return render(
    <Wrapper>
      <BrandInfoStep
        regionTags={mockRegionTags}
        uploadPath="brands/test-uuid"
      />
    </Wrapper>
  )
}

describe('BrandInfoStep', () => {
  it('does not render product type UI (moved to TagsStep)', () => {
    renderBrandInfoStep()

    // Product types were moved to TagsStep — verify they're not here
    expect(screen.queryByPlaceholderText(/手工皮件/)).toBeNull()
    expect(screen.queryByRole('group', { name: '產品類型' })).toBeNull()
  })
})
