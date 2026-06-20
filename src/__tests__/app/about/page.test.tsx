// @vitest-environment jsdom
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

vi.mock('@/components/about/how-it-works', () => ({
  default: () => <section data-testid="how-it-works" />,
}))

vi.mock('@/components/about/trust-model', () => ({
  TrustModel: () => <section data-testid="trust-model" />,
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
}))

vi.mock('@/lib/seo/alternates', () => ({
  buildAlternates: vi.fn(() => ({
    canonical: 'https://example.com/about',
    languages: { en: 'https://example.com/en/about', 'zh-TW': 'https://example.com/zh-TW/about' },
  })),
}))

describe('AboutPage', () => {
  it('renders TrustModel immediately after HowItWorks', async () => {
    const { default: AboutPage } = await import('../../../app/[locale]/about/page')

    render(await AboutPage({ params: Promise.resolve({ locale: 'zh-TW' }) }))

    const howItWorks = screen.getByTestId('how-it-works')
    const trustModel = screen.getByTestId('trust-model')

    expect(howItWorks.nextElementSibling).toBe(trustModel)
    expect(
      howItWorks.compareDocumentPosition(trustModel) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})
