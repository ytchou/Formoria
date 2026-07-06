// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/../messages/en.json'
import zhMessages from '@/../messages/zh-TW.json'
import type { Brand } from '@/lib/types'
import { BrandEditWizard } from '../brand-edit-wizard'

vi.mock('@/lib/actions/brand-edit-wizard', () => ({
  saveSectionDraftAction: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('@/app/[locale]/(protected)/dashboard/brands/[slug]/actions', () => ({
  updateBrandAction: vi.fn().mockResolvedValue({ success: true }),
  saveDraftAction: vi.fn().mockResolvedValue({ success: true }),
  publishDraftAction: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard/brands/test-brand/edit',
}))
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, className }: React.ComponentProps<'a'>) => (
    <a href={href} className={className}>{children}</a>
  ),
}))

// Mock all 9 section components for isolation
vi.mock('../sections/basic-info-section', () => ({ BasicInfoSection: () => <div data-testid="basic-info-section" /> }))
vi.mock('../sections/media-section', () => ({ MediaSection: () => <div data-testid="media-section" /> }))
vi.mock('../sections/links-section', () => ({ LinksSection: () => <div data-testid="links-section" /> }))
vi.mock('../sections/customer-voices-section', () => ({ CustomerVoicesSection: () => <div data-testid="customer-voices-section" /> }))
vi.mock('../sections/locations-section', () => ({ LocationsSection: () => <div data-testid="locations-section" /> }))
vi.mock('../sections/reputation-section', () => ({ ReputationSection: () => <div data-testid="reputation-section" /> }))
vi.mock('../sections/manufacturing-section', () => ({ ManufacturingSection: () => <div data-testid="manufacturing-section" /> }))
vi.mock('../sections/certifications-section', () => ({ CertificationsSection: () => <div data-testid="certifications-section" /> }))
vi.mock('../sections/policies-section', () => ({ PoliciesSection: () => <div data-testid="policies-section" /> }))

const mockBrand: Brand = {
  id: 'test-brand-id',
  slug: 'test-brand',
  name: 'Test Brand',
  productType: 'fashion',
} as Brand

function renderWizard(props = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BrandEditWizard
        brand={mockBrand}
        defaultValues={{ name: 'Test Brand', productType: 'fashion' }}
        initialStep={0}
        {...props}
      />
    </NextIntlClientProvider>
  )
}

describe('BrandEditWizard', () => {
  it('renders the sidebar', () => {
    renderWizard()
    // Sidebar renders step buttons
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0)
  })

  it('localizes wizard navigation labels', () => {
    render(
      <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
        <BrandEditWizard
          brand={mockBrand}
          defaultValues={{ name: 'Test Brand', productType: 'fashion' }}
          initialStep={0}
        />
      </NextIntlClientProvider>
    )

    expect(screen.getAllByText('基本資料').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('progressbar', { name: '第 1 步，共 9 步' })).toBeInTheDocument()
  })

  it('shows the active section content at step 0', () => {
    renderWizard({ initialStep: 0 })
    expect(screen.getByTestId('basic-info-section')).toBeInTheDocument()
    expect(screen.queryByTestId('media-section')).not.toBeInTheDocument()
  })

  it('starts at the correct step when initialStep is provided', () => {
    renderWizard({ initialStep: 2 })
    expect(screen.getByTestId('links-section')).toBeInTheDocument()
  })

  it('navigates to the next section on Save & Continue', async () => {
    renderWizard({ initialStep: 0 })
    const btn = screen.getByRole('button', { name: /save & continue/i })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(screen.getByTestId('media-section')).toBeInTheDocument()
    })
  })

  it('calls saveSectionDraftAction on Save & Continue', async () => {
    const { saveSectionDraftAction } = await import('@/lib/actions/brand-edit-wizard')
    renderWizard({ initialStep: 0 })
    fireEvent.click(screen.getByRole('button', { name: /save & continue/i }))
    await waitFor(() => {
      expect(saveSectionDraftAction).toHaveBeenCalled()
    })
  })

  it('navigates back on Back click', async () => {
    renderWizard({ initialStep: 1 })
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => {
      expect(screen.getByTestId('basic-info-section')).toBeInTheDocument()
    })
  })
})
