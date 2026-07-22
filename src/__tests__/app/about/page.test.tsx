// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
  setRequestLocale: vi.fn(),
}))

vi.mock('@/lib/services/brands', () => ({
  getBrandStats: vi.fn(async () => ({ brandCount: 12, categoryCount: 4 })),
  getRecentBrandCount: vi.fn(async () => 5),
}))

vi.mock('@/components/about/trust-model', () => ({
  TrustModel: () => <section data-testid="trust-model" />,
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

vi.mock('@/components/about/about-hero', () => ({
  default: () => <section data-testid="about-hero" />,
}))

vi.mock('@/components/about/origin-story', () => ({
  default: () => <section data-testid="origin-story" />,
}))

vi.mock('@/components/about/taiwan-stats', () => ({
  default: () => <section data-testid="taiwan-stats" />,
}))

vi.mock('@/components/about/mission-pillars', () => ({
  default: () => <section data-testid="mission-pillars" />,
}))

vi.mock('@/lib/json-ld', () => ({
  buildArticleJsonLd: vi.fn(() => ({ '@context': 'https://schema.org', '@type': 'Article' })),
  buildOrganizationJsonLd: vi.fn(() => ({ '@context': 'https://schema.org', '@type': 'Organization' })),
  safeJsonLdStringify: vi.fn((data: Record<string, unknown>) =>
    JSON.stringify(data).replace(/</g, '\\u003c'),
  ),
}))

vi.mock('@/lib/seo/alternates', () => ({
  buildAlternates: vi.fn(() => ({
    canonical: 'https://example.com/about',
    languages: { en: 'https://example.com/en/about', 'zh-TW': 'https://example.com/zh-TW/about' },
  })),
}))

describe('AboutPage', () => {
  it('renders the brand inclusion criteria before the trust model', async () => {
    const { default: AboutPage } = await import('../../../app/[locale]/about/page')

    render(await AboutPage({ params: Promise.resolve({ locale: 'zh-TW' }) }))

    const heading = screen.getByRole('heading', { level: 2, name: 'qualifies.heading' })
    const body = screen.getByText('qualifies.body')
    const trustModel = screen.getByTestId('trust-model')

    expect(heading).toBeInTheDocument()
    expect(body).toBeInTheDocument()
    expect(
      body.compareDocumentPosition(trustModel) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('finishes with next steps after the trust model', async () => {
    const { default: AboutPage } = await import('../../../app/[locale]/about/page')

    render(await AboutPage({ params: Promise.resolve({ locale: 'zh-TW' }) }))

    const guideLink = screen.getByRole('link', { name: 'guide.cta' })
    const brandsLink = screen.getByRole('link', { name: 'hero.cta' })
    const trustModel = screen.getByTestId('trust-model')

    expect(
      trustModel.compareDocumentPosition(guideLink) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(guideLink).toHaveAttribute('href', '/getting-started')
    expect(brandsLink).toHaveAttribute('href', '/brands')
  })
})
