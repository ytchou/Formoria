// @vitest-environment jsdom
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import enMessages from '../../../../messages/en.json'
import type { Brand } from '@/lib/types'

/**
 * The MDX brand shortcodes are the only place story content touches the brand
 * table. Two things must hold: an unresolvable slug degrades to inert text
 * instead of throwing, and a grid of N brands costs one query, not N.
 */

/**
 * The brand lookup arrives through each component's `loadBrands` seam rather
 * than a module mock: `scripts/check-test-boundaries.mjs` forbids mocking
 * `@/lib/services/*`, and the seam defaults to `getBrandsBySlugs` in production.
 */
const loadBrands = vi.fn<(slugs: string[]) => Promise<Map<string, Brand>>>()

/**
 * `getTranslations` delegates to next-intl's own `createTranslator` against the
 * real `messages/en.json`, rather than a hand-rolled `{name}` substitution.
 *
 * A regex formatter silently diverges from production the moment a message uses
 * ICU syntax — `stories.seriesCount` is a plural — so the test would render
 * "{count, plural, one {# part}…}" as a literal, or render fine while the page
 * broke. Only the message *source* is a boundary here; the formatter is not.
 */
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl')
  const messages = (await import('../../../../messages/en.json')).default

  type TranslatorOptions = Parameters<typeof createTranslator>[0]

  // Both call shapes are in use in the tree: `getTranslations('stories')` in
  // components, `getTranslations({ locale, namespace })` in route files.
  const getTranslations = async (
    options?: string | { locale?: string; namespace?: string },
  ) =>
    createTranslator({
      locale: typeof options === 'string' ? 'en' : (options?.locale ?? 'en'),
      messages,
      namespace: typeof options === 'string' ? options : options?.namespace,
    } as unknown as TranslatorOptions)

  return {
    getLocale: async () => 'en',
    getTranslations,
  }
})

vi.mock('@/i18n/navigation', () => ({
  // `...rest` is load-bearing: destructuring a fixed prop list silently drops
  // `onClick`, and click-tracking assertions then see zero calls against a
  // handler that is wired correctly in production.
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: ReactNode
  } & Omit<ComponentPropsWithoutRef<'a'>, 'href' | 'children'>) => (
    <a href={href} {...rest}>
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

import { getTranslations } from 'next-intl/server'
import { trackBrandCardClicked } from '@/lib/analytics'

import { BrandCardMdx } from '../brand-card-mdx'
import { BrandGrid } from '../brand-grid'

function makeBrand(slug: string, name: string): Brand {
  return {
    id: `id-${slug}`,
    name,
    slug,
    status: 'approved',
    category: 'bags-accessories',
    categorySlug: 'bags-accessories',
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
    subcategories: [],
    subcategoriesEn: [],
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
    loadBrands.mockReset()
  })

  it('renders a brand card when the slug resolves', async () => {
    loadBrands.mockResolvedValue(
      new Map([['molasses', makeBrand('molasses', 'Molasses')]]),
    )

    renderWithIntl(await BrandCardMdx({ slug: 'molasses', loadBrands }))

    expect(screen.getByRole('heading', { name: 'Molasses' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Molasses' })).toHaveAttribute(
      'href',
      '/brands/molasses',
    )
  })

  it('renders a dashed placeholder containing the slug when it does not resolve', async () => {
    loadBrands.mockResolvedValue(new Map())

    renderWithIntl(await BrandCardMdx({ slug: 'ghost-brand', loadBrands }))

    const placeholder = screen.getByText('Brand unavailable: ghost-brand')
    expect(placeholder).toBeInTheDocument()
    expect(placeholder.className).toContain('border-dashed')
    // Inert: nothing to navigate to, so it must not take a tab stop.
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders the editorial note when provided', async () => {
    loadBrands.mockResolvedValue(
      new Map([['molasses', makeBrand('molasses', 'Molasses')]]),
    )

    renderWithIntl(
      await BrandCardMdx({ slug: 'molasses', note: 'Their kettle sugar is the whole story.', loadBrands }),
    )

    expect(screen.getByText('Their kettle sugar is the whole story.')).toBeInTheDocument()
    // The author's note replaces the generated blurb rather than joining it.
    expect(screen.queryByText('Directory blurb')).toBeNull()
  })

  it('renders the eyebrow when provided', async () => {
    loadBrands.mockResolvedValue(
      new Map([['molasses', makeBrand('molasses', 'Molasses')]]),
    )

    renderWithIntl(await BrandCardMdx({ slug: 'molasses', eyebrow: 'Field notes', loadBrands }))

    expect(screen.getByText('Field notes')).toBeInTheDocument()
  })
})

describe('BrandGrid', () => {
  beforeEach(() => {
    loadBrands.mockReset()
    vi.mocked(trackBrandCardClicked).mockClear()
  })

  it('issues one batched lookup for all slugs', async () => {
    const slugs = ['molasses', 'kiln-studio', 'paper-mill']
    loadBrands.mockResolvedValue(
      new Map(slugs.map((slug) => [slug, makeBrand(slug, slug)])),
    )

    renderWithIntl(await BrandGrid({ slugs, loadBrands }))

    expect(loadBrands).toHaveBeenCalledTimes(1)
    expect(loadBrands).toHaveBeenCalledWith(slugs)
    expect(screen.getAllByRole('heading')).toHaveLength(3)
  })

  it('numbers its cards from startIndex so two grids do not both report rank 0', async () => {
    // Every grid otherwise indexes from 0, so a story with two of them reports
    // two different brands at `position_in_grid: 0` and GA4 rank analysis mixes
    // them. `startIndex` is the manual escape hatch until a story-scoped counter
    // is threaded through the shortcode map.
    const slugs = ['tainan-soy', 'paper-mill']
    loadBrands.mockResolvedValue(
      new Map(slugs.map((slug) => [slug, makeBrand(slug, slug)])),
    )

    renderWithIntl(await BrandGrid({ slugs, startIndex: 3, loadBrands }))
    fireEvent.click(screen.getByRole('link', { name: 'paper-mill' }))

    expect(vi.mocked(trackBrandCardClicked)).toHaveBeenCalledWith(
      'paper-mill',
      'bags-accessories',
      4,
      'id-paper-mill',
    )
  })
})

/**
 * Guards the translator this file mocks, not a component. A hand-rolled `{name}`
 * substitution renders ICU syntax literally, so every assertion above would keep
 * passing while the real page shipped `{count, plural, …}` to readers.
 */
describe('the mocked server translator', () => {
  it('formats ICU plurals the way next-intl does in production', async () => {
    const t = await getTranslations('stories')

    expect(t('seriesCount', { count: 1 })).toBe('1 part')
    expect(t('seriesCount', { count: 5 })).toBe('5 parts')
  })
})
