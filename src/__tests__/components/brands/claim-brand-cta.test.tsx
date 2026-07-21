// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ClaimBrandCta } from '@/components/brands/claim-brand-cta'

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: (namespace: string) => {
    const translations: Record<string, string> = {
      'brands.claimCta.communityTitle': 'Is this your brand?',
      'brands.claimCta.communityListing':
        "Claim your listing with business proof — domain email, backend access, or an official document. Once reviewed, you manage your brand's presence directly: update details, add products, and build trust with customers.",
      'brands.claimCta.signIn': 'Sign in to claim',
      'brands.claimCta.claimButton': 'Claim this brand',
      'brands.claimCta.whyClaim': 'Why claim?',
      'brandDetail.claim.errors.notLoggedIn': 'Sign in to submit a claim request.',
    }
    const t = (key: string) => translations[`${namespace}.${key}`] ?? key
    t.raw = (key: string) => translations[`${namespace}.${key}`] ?? key
    return t
  },
}))

vi.mock('@/lib/auth/use-user', () => ({
  useUser: () => ({
    user: null,
    loading: false,
    viewer: { hasOwnedBrand: false, isAdmin: false, impersonation: null },
    viewerLoading: false,
  }),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  usePathname: () => '/brands/test-brand',
}))

vi.mock('@/components/upload/useImageUpload', () => ({
  useImageUpload: () => ({
    upload: vi.fn(),
    uploading: false,
    progress: 0,
    status: 'idle',
    key: null,
    url: null,
    error: null,
  }),
}))

vi.mock('@/app/[locale]/brands/[slug]/actions', () => ({
  getPendingClaimStatusAction: vi.fn(),
  submitClaimAction: vi.fn(),
}))

vi.mock('@/lib/analytics', () => ({
  trackBrandClaimStarted: vi.fn(),
  trackBrandClaimFormSubmitted: vi.fn(),
}))

describe('ClaimBrandCta', () => {
  it('renders proof-based claim body copy', () => {
    render(<ClaimBrandCta brandId="brand-1" brandSlug="brand-1-slug" />)

    expect(screen.getByText(/Claim your listing with business proof/)).toBeInTheDocument()
  })

  it('does not render legacy submit-proof copy', () => {
    render(<ClaimBrandCta brandId="brand-1" brandSlug="brand-1-slug" />)

    expect(screen.queryByText(/submit proof to claim and manage/)).not.toBeInTheDocument()
  })
})
