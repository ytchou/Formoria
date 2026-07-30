// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import enMessages from '../../../../messages/en.json'
import type { Brand } from '@/lib/types'

/**
 * The MDX brand shortcodes are the only place story content touches the brand
 * table. Two things must hold: an unresolvable slug degrades to inert text
 * instead of throwing, and a grid of N brands costs one query, not N.
 */

const mocks = vi.hoisted(() => ({
  getBrandsBySlugs: vi.fn(),
}))

vi.mock('@/lib/services/brands', () => ({
  getBrandsBySlugs: mocks.getBrandsBySlugs,
}))

vi.mock('next-intl/server', async () => {
  const messages = (await import('../../../../messages/en.json')).default as Record<
    string,
    unknown
  >

  return {
    getLocale: async () => 'en',
    getTranslations: async (namespace: string) => {
      const scope = (messages[namespace] ?? {}) as Record<string, unknown>
      return (key: string, values?: Record<string, string | number>) => {
        const template = key
          .split('.')
          .reduce<unknown>(
            (acc, part) => (acc as Record<string, unknown> | undefined)?.[part],
            scope,
          )
        if (typeof template !== 'string') return key
        if (!values) return template
        return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
          String(values[name] ?? ''),
        )
      }
    },
  }
})

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    className,
  }: {
    href: string
    children: ReactNode
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
  usePathname: () => '/stories/a-story',
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('next/image', () => ({
  default: ({ alt = '', src }: { alt?: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={typeof src === 'string' ? src : ''} />
  ),
}))

vi.mock('@/lib/auth/use-user', () => ({
  useUser: () => ({ user: null, loading: false }),
}))

vi.mock('@/lib/analytics', () => ({
  trackBrandCardClicked: vi.fn(),
  trackRecommendationBrandClicked: vi.fn(),
  trackBrandSaved: vi.fn(),
  trackBrandUnsaved: vi.fn(),
}))

import { BrandCardMdx } from '../brand-card-mdx'
import { BrandGrid } from '../brand-grid'

function makeBrand(slug: string, name: string): Brand {
  return {
    id: `id-${slug}`,
    name,
    slug,
    status: 'approved',
    category: 'bags-accessories',
    productType: 'bags-accessories',
    heroImageUrl: null,
    productPhotos: [],
    imageAlts: [],
    blurb: 'Directory blurb',
    blurbEn: 'Directory blurb',
    description: null,
    descriptionEn: null,
    isVerified: false,
    mitStatus: 'unverified',
    priceRange: null,
    productTags: [],
    productTagsEn: [],
  } as unknown as Brand
}

function renderWithIntl(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  )
}

describe('BrandCardMdx', () => {
  beforeEach(() => {
    mocks.getBrandsBySlugs.mockReset()
  })

  it('renders a brand card when the slug resolves', async () => {
    mocks.getBrandsBySlugs.mockResolvedValue(
      new Map([['molasses', makeBrand('molasses', 'Molasses')]]),
    )

    renderWithIntl(await BrandCardMdx({ slug: 'molasses' }))

    expect(screen.getByRole('heading', { name: 'Molasses' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Molasses' })).toHaveAttribute(
      'href',
      '/brands/molasses',
    )
  })

  it('renders a dashed placeholder containing the slug when it does not resolve', async () => {
    mocks.getBrandsBySlugs.mockResolvedValue(new Map())

    renderWithIntl(await BrandCardMdx({ slug: 'ghost-brand' }))

    const placeholder = screen.getByText('Brand unavailable: ghost-brand')
    expect(placeholder).toBeInTheDocument()
    expect(placeholder.className).toContain('border-dashed')
    // Inert: nothing to navigate to, so it must not take a tab stop.
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders the editorial note when provided', async () => {
    mocks.getBrandsBySlugs.mockResolvedValue(
      new Map([['molasses', makeBrand('molasses', 'Molasses')]]),
    )

    renderWithIntl(
      await BrandCardMdx({ slug: 'molasses', note: 'Their kettle sugar is the whole story.' }),
    )

    expect(screen.getByText('Their kettle sugar is the whole story.')).toBeInTheDocument()
    // The author's note replaces the generated blurb rather than joining it.
    expect(screen.queryByText('Directory blurb')).toBeNull()
  })

  it('renders the eyebrow when provided', async () => {
    mocks.getBrandsBySlugs.mockResolvedValue(
      new Map([['molasses', makeBrand('molasses', 'Molasses')]]),
    )

    renderWithIntl(await BrandCardMdx({ slug: 'molasses', eyebrow: 'Field notes' }))

    expect(screen.getByText('Field notes')).toBeInTheDocument()
  })
})

describe('BrandGrid', () => {
  beforeEach(() => {
    mocks.getBrandsBySlugs.mockReset()
  })

  it('issues one batched lookup for all slugs', async () => {
    const slugs = ['molasses', 'kiln-studio', 'paper-mill']
    mocks.getBrandsBySlugs.mockResolvedValue(
      new Map(slugs.map((slug) => [slug, makeBrand(slug, slug)])),
    )

    renderWithIntl(await BrandGrid({ slugs }))

    expect(mocks.getBrandsBySlugs).toHaveBeenCalledTimes(1)
    expect(mocks.getBrandsBySlugs).toHaveBeenCalledWith(slugs)
    expect(screen.getAllByRole('heading')).toHaveLength(3)
  })
})
