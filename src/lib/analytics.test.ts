// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockSendGAEvent = vi.fn()
const mockPostHogCapture = vi.fn()
vi.mock('./analytics/posthog-provider', () => ({
  capturePostHogEvent: (...args: unknown[]) => mockPostHogCapture(...args),
}))
import {
  getContentGroup,
  isPublicAnalyticsPath,
  getUtmParams,
  persistUtmTouchPoints,
  trackBrandDetailViewed,
  trackBrandCardClicked,
  trackExternalLinkClicked,
  trackCategoryFilterApplied,
  trackSearchExecuted,
  trackSearchResultClicked,
  trackSearchNoResults,
  trackSearchSuggestionSelect,
  trackSubmissionFormOpened,
  trackSubmissionFormStepCompleted,
  trackSubmissionCompleted,
  trackSubmissionFormAbandoned,
  trackGalleryPhotoView,
  trackBrandPageShared,
  trackSignUp,
  trackLogin,
  trackViewItemList,
  trackHeroCategoryClicked,
  trackDirectorySortChanged,
  trackDirectoryPageNavigated,
  trackSubcategoryFilterApplied,
  trackPriceFilterApplied,
  trackVerificationFilterApplied,
  trackFilterCleared,
  trackLanguageSwitched,
  trackBrandSaved,
  trackBrandUnsaved,
  trackBrandLiked,
  trackBrandUnliked,
  trackRecommendationBrandClicked,
  trackRecommendationSectionViewed,
  trackGalleryCompleted,
  trackFaqItemExpanded,
  trackSubmissionPathSelected,
  trackNewsletterSubscribed,
  trackBrandClaimStarted,
  trackMitDeclared,
  trackOriginEvidenceSubmitted,
  trackBrandClaimFormSubmitted,
  trackBrandReported,
  trackCtaClicked,
  trackSubmissionFormErrorShown,
  trackApiErrorShown,
} from './analytics'

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
    '/dashboard',
    '/en/dashboard/brands',
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

  it('never sends raw search text or proposed brand names to PostHog', () => {
    trackSearchExecuted('private query', 4)
    trackSearchNoResults('another private query')
    trackSubmissionCompleted('Secret proposed brand', 'fashion', true, 120)

    expect(mockPostHogCapture).toHaveBeenNthCalledWith(1, 'brand_search_executed', {
      query_length: 13,
      result_count: 4,
      has_results: true,
    })
    expect(mockPostHogCapture).toHaveBeenNthCalledWith(2, 'brand_search_empty', {
      query_length: 21,
    })
    expect(JSON.stringify(mockPostHogCapture.mock.calls)).not.toContain('private query')
    expect(JSON.stringify(mockPostHogCapture.mock.calls)).not.toContain('Secret proposed brand')
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

describe('brand like tracking', () => {
  it('tracks public brand likes and removals separately from saves', () => {
    trackBrandLiked('brand-uuid', 'my-brand')
    trackBrandUnliked('brand-uuid', 'my-brand')

    expect(mockPostHogCapture).toHaveBeenNthCalledWith(1, 'brand_liked', {
      brand_id: 'brand-uuid',
      brand_slug: 'my-brand',
      location: 'brand_detail',
    })
    expect(mockPostHogCapture).toHaveBeenNthCalledWith(2, 'brand_unliked', {
      brand_id: 'brand-uuid',
      brand_slug: 'my-brand',
      location: 'brand_detail',
    })
  })
})
