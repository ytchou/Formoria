// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import { BrandInfoStep } from './BrandInfoStep'
import { checkDuplicates } from '@/app/[locale]/submit/actions'
import type { SubmissionFormData } from '@/lib/validations/submission'
import type { TaxonomyTag } from '@/lib/types/taxonomy'

vi.mock('@/app/[locale]/submit/actions', () => ({
  checkDuplicates: vi.fn(),
  submitBrand: vi.fn(),
}))

const translations: Record<string, string> = {
  ubn: '統一編號（選填）',
  ubnHint: '8位數字，公司或商號的統一編號，由經濟部核發',
  ubnDuplicateTitle: '此統一編號的品牌已存在於目錄中',
  ubnDuplicateSeeExisting: '請查看現有品牌：',
  nameDuplicateTitle: '發現相似品牌名稱',
  nameDuplicateConfirmLabel: '我確認這不是重複的品牌',
  checking: '檢查中',
}

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => translations[key] ?? key,
}))

vi.mock('../upload/ImageUploader', () => ({
  ImageUploader: () => <div data-testid="image-uploader" />,
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}))

const mockCheckDuplicates = vi.mocked(checkDuplicates)

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

function Wrapper({
  children,
  defaultValues,
}: {
  children: React.ReactNode
  defaultValues?: Partial<SubmissionFormData>
}) {
  const methods = useForm<SubmissionFormData>({
    defaultValues: {
      name: '雨靴工作室',
      description: '這是一段足夠長的品牌介紹，用來讓表單在測試中保持可提交狀態。',
      category: 'fashion',
      unifiedBusinessNumber: '',
      region: 'taipei',
      valueTags: [],
      logoUrl: '',
      productPhotos: [],
      purchaseLinks: [],
      socialLinks: {
        instagram: '',
        threads: '',
        facebook: '',
        website: '',
      },
      retailLocations: [],
      pdpaConsent: false,
      turnstileToken: '',
      _honeypot: '',
      ...defaultValues,
    },
  })

  return <FormProvider {...methods}>{children}</FormProvider>
}

function renderBrandInfoStep({
  onNext = vi.fn(),
  defaultValues,
}: {
  onNext?: (values: SubmissionFormData) => void
  defaultValues?: Partial<SubmissionFormData>
} = {}) {
  render(
    <Wrapper defaultValues={defaultValues}>
      <BrandInfoStep
        regionTags={mockRegionTags}
        uploadPath="brands/test-uuid"
        onNext={onNext}
      />
    </Wrapper>
  )

  return { onNext }
}

describe('BrandInfoStep duplicate checks', () => {
  beforeEach(() => {
    mockCheckDuplicates.mockReset()
  })

  it('renders 統一編號 input field', () => {
    renderBrandInfoStep()

    expect(screen.getByLabelText(/統一編號/)).toBeInTheDocument()
  })

  it('hard blocks when checkDuplicates returns a ubnMatch', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    mockCheckDuplicates.mockResolvedValue({
      ubnMatch: {
        id: 'brand-1',
        name: '既有品牌',
        slug: 'existing-brand',
      },
      nameMatches: [],
    })

    renderBrandInfoStep({
      onNext,
      defaultValues: { unifiedBusinessNumber: '12345678' },
    })

    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(
      await screen.findByText('此統一編號的品牌已存在於目錄中')
    ).toBeInTheDocument()
    expect(onNext).not.toHaveBeenCalled()
  })

  it('shows name warning and confirmation checkbox for name matches', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    mockCheckDuplicates.mockResolvedValue({
      ubnMatch: null,
      nameMatches: [
        {
          id: 'brand-1',
          name: '相似品牌',
          slug: 'similar-brand',
          similarity: 0.91,
        },
      ],
    })

    renderBrandInfoStep({ onNext })

    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(await screen.findByText('發現相似品牌名稱')).toBeInTheDocument()
    expect(screen.getByText(/相似品牌 \(91%\)/)).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: '我確認這不是重複的品牌' })
    ).toBeInTheDocument()
    expect(onNext).not.toHaveBeenCalled()
  })

  it('proceeds after checking the confirmation checkbox', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    mockCheckDuplicates.mockResolvedValue({
      ubnMatch: null,
      nameMatches: [
        {
          id: 'brand-1',
          name: '相似品牌',
          slug: 'similar-brand',
          similarity: 0.91,
        },
      ],
    })

    renderBrandInfoStep({ onNext })

    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(await screen.findByRole('checkbox', { name: '我確認這不是重複的品牌' }))
    await user.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => {
      expect(onNext).toHaveBeenCalledTimes(1)
    })
  })

  it('proceeds when checkDuplicates returns no matches', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    mockCheckDuplicates.mockResolvedValue({
      ubnMatch: null,
      nameMatches: [],
    })

    renderBrandInfoStep({ onNext })

    await user.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => {
      expect(onNext).toHaveBeenCalledTimes(1)
    })
  })
})
