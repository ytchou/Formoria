// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockSendGAEvent = vi.fn()
const mockPostHogCapture = vi.fn()
vi.mock('./analytics/posthog-provider', () => ({
  capturePostHogEvent: (...args: unknown[]) => mockPostHogCapture(...args),
}))
// Only the FAQ component below reads translations; analytics itself does not.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
import { createElement } from 'react'
import {
  getContentGroup,
  isPublicAnalyticsPath,
  getUtmParams,
  persistUtmTouchPoints,
  trackBrandDetailViewed,
  trackBrandCardClicked,
  trackCuratedProductClicked,
  trackStoryCardClicked,
  trackExternalLinkClicked,
  trackSearchExecuted,
  trackProductSearchExecuted,
  trackSearchResultClicked,
  trackSearchNoResults,
  trackSearchSuggestionSelect,
  trackSubmissionCompleted,
  trackGalleryPhotoView,
  trackBrandPageShared,
  trackSubcategoryFilterApplied,
  trackFaqItemExpanded,
  trackBrandDetailEngaged,
  trackSavedBrandRevisited,
  trackNotFoundCategoryClicked,
} from './analytics'
import { ANALYTICS_EVENTS } from './analytics/events'

beforeEach(() => {
  mockSendGAEvent.mockClear()
  mockPostHogCapture.mockClear()
  window.gtag = mockSendGAEvent
  window.history.replaceState({}, '', '/')
})

describe('getUtmParams', () => {
  it('extracts all UTM params', () => {
    expect(
      getUtmParams(
        '?utm_source=google&utm_medium=cpc&utm_campaign=spring&utm_term=shoes&utm_content=ad-a&foo=bar'
      )
    ).toEqual({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'spring',
      utm_term: 'shoes',
      utm_content: 'ad-a',
    })
  })

  it('returns only present params', () => {
    expect(getUtmParams('?utm_source=newsletter&utm_campaign=launch')).toEqual({
      utm_source: 'newsletter',
      utm_campaign: 'launch',
    })
  })

  it('returns empty object when no UTM params', () => {
    expect(getUtmParams('?q=brands&page=2')).toEqual({})
  })

  it('returns empty for empty string', () => {
    expect(getUtmParams('')).toEqual({})
  })
})

describe('getContentGroup', () => {
  it('maps /zh-TW root to directory', () => {
    expect(getContentGroup('/zh-TW')).toBe('directory')
  })

  it('maps /en root to directory', () => {
    expect(getContentGroup('/en')).toBe('directory')
  })

  it('maps /zh-TW/brands to directory', () => {
    expect(getContentGroup('/zh-TW/brands')).toBe('directory')
  })

  it('maps /zh-TW/brands/some-brand to brand_detail', () => {
    expect(getContentGroup('/zh-TW/brands/some-brand')).toBe('brand_detail')
  })

  it('maps /zh-TW/submit to submission', () => {
    expect(getContentGroup('/zh-TW/submit')).toBe('submission')
  })

  it('maps admin paths to admin', () => {
    expect(getContentGroup('/admin')).toBe('admin')
    expect(getContentGroup('/admin/reports')).toBe('admin')
  })

  it('maps /zh-TW/about to about', () => {
    expect(getContentGroup('/zh-TW/about')).toBe('about')
  })

  it('maps /zh-TW/privacy to other', () => {
    expect(getContentGroup('/zh-TW/privacy')).toBe('other')
  })
})

describe('isPublicAnalyticsPath', () => {
  it.each([
    '/admin',
    '/admin/reports',
    '/zh-TW/admin',
    '/auth/callback',
    '/zh-TW/auth/login',
  ])('rejects protected path %s', (pathname) => {
    expect(isPublicAnalyticsPath(pathname)).toBe(false)
  })

  it.each(['/', '/zh-TW', '/en/brands', '/zh-TW/brands/formoria']) (
    'accepts public path %s',
    (pathname) => {
      expect(isPublicAnalyticsPath(pathname)).toBe(true)
    },
  )
})

describe('persistUtmTouchPoints', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('stores first touch on initial visit', () => {
    expect(
      persistUtmTouchPoints({
        utm_source: 'google',
        utm_medium: 'cpc',
      })
    ).toEqual({
      first_touch_source: 'google',
      first_touch_medium: 'cpc',
      last_touch_source: 'google',
      last_touch_medium: 'cpc',
    })
  })

  it('preserves first touch and updates last touch on subsequent visits', () => {
    persistUtmTouchPoints({
      utm_source: 'google',
      utm_medium: 'cpc',
    })

    expect(
      persistUtmTouchPoints({
        utm_source: 'newsletter',
        utm_campaign: 'summer',
      })
    ).toEqual({
      first_touch_source: 'google',
      first_touch_medium: 'cpc',
      last_touch_source: 'newsletter',
      last_touch_campaign: 'summer',
    })
  })

  it('returns null when empty params and no stored data', () => {
    expect(persistUtmTouchPoints({})).toBeNull()
  })

  it('handles corrupted localStorage gracefully without losing first touch', () => {
    // Store valid first touch
    persistUtmTouchPoints({ utm_source: 'google', utm_medium: 'cpc' })
    // Corrupt the first touch entry
    window.localStorage.setItem('formoria_utm_first_touch', 'not-json')
    // Should still work - treat corrupted first touch as missing but don't crash
    const result = persistUtmTouchPoints({
      utm_source: 'twitter',
      utm_medium: 'social',
    })
    expect(result).not.toBeNull()
    expect(result!.last_touch_source).toBe('twitter')
  })
})


describe('analytics', () => {

  it('curated_product_clicked_carries_product_and_brand', () => {
    trackCuratedProductClicked(
      'linen-mug',
      'warmwood',
      2,
      'homepage_selected_products',
    )

    expect(mockPostHogCapture).toHaveBeenCalledWith(ANALYTICS_EVENTS.CURATED_PRODUCT_CLICKED, {
      product_key: 'linen-mug',
      brand_slug: 'warmwood',
      position: 2,
      selection_surface: 'homepage_selected_products',
    })
  })

  it('story_card_clicked_fires_from_story_row', () => {
    trackStoryCardClicked('slow-living', 1, 'homepage_latest_stories')

    expect(mockPostHogCapture).toHaveBeenCalledWith(ANALYTICS_EVENTS.STORY_CARD_CLICKED, {
      story_slug: 'slow-living',
      position: 1,
      story_surface: 'homepage_latest_stories',
    })
  })

  it('story_card_clicked_carries the discovery trail continuation surface', () => {
    trackStoryCardClicked('slow-living', 0, 'trail_related_stories')

    expect(mockPostHogCapture).toHaveBeenCalledWith(ANALYTICS_EVENTS.STORY_CARD_CLICKED, {
      story_slug: 'slow-living',
      position: 0,
      story_surface: 'trail_related_stories',
    })
  })

  it('brand_card_clicked_carries_list_source', () => {
    trackBrandCardClicked(
      'warmwood',
      'home',
      3,
      'brand-uuid',
      'homepage_explore',
    )

    expect(mockPostHogCapture).toHaveBeenCalledWith(ANALYTICS_EVENTS.BRAND_CARD_CLICKED, {
      brand_id: 'brand-uuid',
      brand_slug: 'warmwood',
      category: 'home',
      position_in_grid: 3,
      list_source: 'homepage_explore',
    })
  })

  it('includes immutable IDs and public slugs on PostHog brand interactions', () => {
    trackSearchResultClicked('private query', 2, 'brand-uuid', 'my-brand')
    trackSearchSuggestionSelect('my-brand', 'brand-uuid')
    trackGalleryPhotoView('my-brand', 1, 'brand-uuid')

    expect(mockPostHogCapture).toHaveBeenNthCalledWith(1, 'search_result_clicked', {
      query_length: 13,
      position_in_results: 2,
      brand_id: 'brand-uuid',
      brand_slug: 'my-brand',
    })
    expect(mockPostHogCapture).toHaveBeenNthCalledWith(2, 'search_suggestion_selected', {
      brand_id: 'brand-uuid',
      brand_slug: 'my-brand',
    })
    expect(mockPostHogCapture).toHaveBeenNthCalledWith(3, 'gallery_photo_viewed', {
      brand_id: 'brand-uuid',
      brand_slug: 'my-brand',
      photo_index: 1,
    })
    expect(JSON.stringify(mockPostHogCapture.mock.calls)).not.toContain('private query')
  })

  // DEV-1408 reversed the search-text exclusion: knowing a search failed is far less
  // useful than knowing what it wanted. Proposed brand names stay excluded.
  it('sends search text but never proposed brand names to PostHog', () => {
    trackSearchExecuted('ceramic mugs', 4)
    trackSearchNoResults('handmade linen apron')
    trackSubmissionCompleted('Secret proposed brand', 'fashion', true, 120)

    expect(mockPostHogCapture).toHaveBeenNthCalledWith(1, 'brand_search_executed', {
      query_length: 12,
      result_count: 4,
      has_results: true,
      search_term: 'ceramic mugs',
    })
    expect(mockPostHogCapture).toHaveBeenNthCalledWith(2, 'brand_search_empty', {
      query_length: 20,
      search_term: 'handmade linen apron',
    })
    expect(JSON.stringify(mockPostHogCapture.mock.calls)).not.toContain('Secret proposed brand')
  })

  it('drops search text that looks like contact details, and caps the rest', () => {
    trackSearchExecuted('person@example.com', 0)
    trackSearchNoResults('0912345678')
    trackSearchExecuted('  spaced  ', 1)
    trackSearchExecuted('x'.repeat(150), 1)

    // Absent rather than empty — an omitted property is unambiguous downstream.
    expect(mockPostHogCapture.mock.calls[0]?.[1]).not.toHaveProperty('search_term')
    expect(mockPostHogCapture.mock.calls[1]?.[1]).not.toHaveProperty('search_term')
    expect(mockPostHogCapture.mock.calls[2]?.[1]).toMatchObject({ search_term: 'spaced' })
    expect(mockPostHogCapture.mock.calls[3]?.[1]).toMatchObject({
      search_term: 'x'.repeat(100),
    })
    expect(JSON.stringify(mockPostHogCapture.mock.calls)).not.toContain('person@example.com')
    expect(JSON.stringify(mockPostHogCapture.mock.calls)).not.toContain('0912345678')
  })



















  it('trackProductSearchExecuted captures product_search_executed with search_source and degraded and the capped search_term', () => {
    trackProductSearchExecuted('ceramic mug', 5, { searchSource: 'discover_page', degraded: false })

    expect(mockPostHogCapture).toHaveBeenCalledWith(ANALYTICS_EVENTS.PRODUCT_SEARCH_EXECUTED, {
      query_length: 11,
      result_count: 5,
      has_results: true,
      search_source: 'discover_page',
      degraded: false,
      search_term: 'ceramic mug',
    })
  })

  it('trackProductSearchExecuted drops search_term for email-like queries', () => {
    trackProductSearchExecuted('person@example.com', 0, { searchSource: 'url', degraded: true })

    const payload = mockPostHogCapture.mock.calls[0]?.[1] as Record<string, unknown>
    expect(payload).not.toHaveProperty('search_term')
    expect(payload.search_source).toBe('url')
    expect(payload.degraded).toBe(true)
  })

  it('trackNotFoundCategoryClicked fires PostHog event', () => {
    trackNotFoundCategoryClicked('fashion', 0)

    expect(mockPostHogCapture).toHaveBeenCalledWith(ANALYTICS_EVENTS.NOT_FOUND_CATEGORY_CLICKED, {
      category_slug: 'fashion',
      position: 0,
    })
  })

  it('does not throw when gtag fails', () => {
    mockSendGAEvent.mockImplementation(() => {
      throw new Error('gtag not loaded')
    })
    expect(() => trackBrandDetailViewed('test')).not.toThrow()
  })
})















describe('brand share tracking', () => {
  it('trackBrandPageShared sends brand_page_shared with the channel', () => {
    trackBrandPageShared('my-brand', 'brand-uuid', 'threads')

    expect(mockPostHogCapture).toHaveBeenCalledWith('brand_page_shared', {
      brand_id: 'brand-uuid',
      brand_slug: 'my-brand',
      method: 'threads',
    })
  })
})

// These assertions are the regression guard for an irreversible contract: PostHog
// event names and property types can never be renamed or retyped after first
// emission. Any change that makes these fail is a breaking analytics change.
describe('brand engagement tracking', () => {
  it('trackBrandDetailEngaged sends brand_detail_engaged with the winning trigger', () => {
    trackBrandDetailEngaged('my-brand', 'gallery', 'brand-uuid')

    expect(mockPostHogCapture).toHaveBeenCalledWith('brand_detail_engaged', {
      brand_slug: 'my-brand',
      trigger: 'gallery',
      brand_id: 'brand-uuid',
    })
  })

  it('omits brand_id when it is unknown and never reaches GA', () => {
    trackBrandDetailEngaged('my-brand', 'scroll_50')

    expect(mockPostHogCapture).toHaveBeenCalledWith('brand_detail_engaged', {
      brand_slug: 'my-brand',
      trigger: 'scroll_50',
    })
    expect(mockSendGAEvent).not.toHaveBeenCalled()
  })
})

describe('saved brand revisit tracking', () => {
  it('trackSavedBrandRevisited distinguishes card and detail-page surfaces', () => {
    trackSavedBrandRevisited('my-brand', 'card', 'brand-uuid')
    trackSavedBrandRevisited('my-brand', 'detail_page', 'brand-uuid')

    expect(mockPostHogCapture).toHaveBeenNthCalledWith(1, 'saved_brand_revisited', {
      brand_slug: 'my-brand',
      revisit_surface: 'card',
      brand_id: 'brand-uuid',
    })
    expect(mockPostHogCapture).toHaveBeenNthCalledWith(2, 'saved_brand_revisited', {
      brand_slug: 'my-brand',
      revisit_surface: 'detail_page',
      brand_id: 'brand-uuid',
    })
    expect(mockSendGAEvent).not.toHaveBeenCalled()
  })

  it('omits brand_id when it is unknown', () => {
    trackSavedBrandRevisited('my-brand', 'card')

    expect(mockPostHogCapture).toHaveBeenCalledWith('saved_brand_revisited', {
      brand_slug: 'my-brand',
      revisit_surface: 'card',
    })
  })
})

describe('external link surface attribution', () => {
  // Regression guard: this MUST be `link_surface`, never `surface`. A top-level
  // `surface` is unconditionally overwritten with 'public' | 'product' by the
  // before_send scrubber in posthog-privacy.ts, so the value would never arrive.
  it('sends link_surface on both PostHog and GA payloads, never bare surface', () => {
    trackExternalLinkClicked('my-brand', 'website', '/brands/my-brand', 'detail_page', 'brand-uuid')

    expect(mockPostHogCapture).toHaveBeenCalledWith('external_link_clicked', {
      brand_id: 'brand-uuid',
      brand_slug: 'my-brand',
      link_type: 'website',
      link_surface: 'detail_page',
    })
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'external_link_clicked', {
      brand_slug: 'my-brand',
      link_type: 'website',
      referrer_page: '/brands/my-brand',
      link_surface: 'detail_page',
    })
  })

  it('never emits a bare `surface` key that the scrubber would overwrite', () => {
    trackExternalLinkClicked('my-brand', 'website', '/brands/my-brand', 'card', 'brand-uuid')
    trackSavedBrandRevisited('my-brand', 'card', 'brand-uuid')

    for (const [, properties] of mockPostHogCapture.mock.calls) {
      expect(properties).not.toHaveProperty('surface')
    }
  })

  it('preserves the trail and section in external-link attribution', () => {
    trackExternalLinkClicked(
      'my-brand',
      'curated_product',
      '/style/small-space-reading-corner',
      'trail:small-space-reading-corner:light-first',
      'brand-uuid',
    )

    expect(mockPostHogCapture).toHaveBeenCalledWith('external_link_clicked', {
      brand_id: 'brand-uuid',
      brand_slug: 'my-brand',
      link_type: 'curated_product',
      link_surface: 'trail:small-space-reading-corner:light-first',
    })
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'external_link_clicked', {
      brand_slug: 'my-brand',
      link_type: 'curated_product',
      referrer_page: '/style/small-space-reading-corner',
      link_surface: 'trail:small-space-reading-corner:light-first',
    })
  })
})

describe('filter result counts', () => {
  it('trackSubcategoryFilterApplied sends result_count as an integer', () => {
    trackSubcategoryFilterApplied('tea', 'food-drink', 12)

    expect(mockPostHogCapture).toHaveBeenCalledWith('subcategory_filter_applied', {
      subcategory: 'tea',
      parent_category: 'food-drink',
      result_count: 12,
    })
    const [, properties] = mockPostHogCapture.mock.calls[0] as [
      string,
      { result_count: number },
    ]
    expect(Number.isInteger(properties.result_count)).toBe(true)
  })
})

describe('brand faq tracking', () => {
  it('tracks faq item expanded with preset id', () => {
    trackFaqItemExpanded('my-brand', 'main-products')

    expect(mockPostHogCapture).toHaveBeenCalledWith('faq_item_expanded', {
      brand_slug: 'my-brand',
      preset_id: 'main-products',
    })
  })

  it('does not emit on collapse', async () => {
    const { BrandFaqAccordion } = await import(
      '@/components/brands/brand-faq-accordion'
    )
    const { render, act } = await import('@testing-library/react')

    render(
      createElement(BrandFaqAccordion, {
        brandSlug: 'my-brand',
        items: [
          { id: 'main-products', question: 'What does it make?', answer: 'Bags.' },
        ],
      })
    )

    const details = document.getElementById(
      'faq-main-products'
    ) as HTMLDetailsElement

    // The answer is in the DOM even while collapsed — the whole point of
    // rendering native <details> instead of a JS accordion.
    expect(details.open).toBe(false)
    expect(details.textContent).toContain('Bags.')

    act(() => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    expect(mockPostHogCapture).toHaveBeenCalledTimes(1)

    act(() => {
      details.open = false
      details.dispatchEvent(new Event('toggle'))
    })
    expect(mockPostHogCapture).toHaveBeenCalledTimes(1)
  })
})
