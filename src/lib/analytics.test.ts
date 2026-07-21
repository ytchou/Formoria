// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockSendGAEvent = vi.fn()
const mockPostHogCapture = vi.fn()
vi.mock('./analytics/posthog-provider', () => ({
  capturePostHogEvent: (...args: unknown[]) => mockPostHogCapture(...args),
}))
import * as analytics from './analytics'
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
} from './analytics'

beforeEach(() => {
  mockSendGAEvent.mockClear()
  mockPostHogCapture.mockClear()
  window.gtag = mockSendGAEvent
  window.history.replaceState({}, '', '/')
})

describe('analytics — onboarding events removed', () => {
  it('does not export trackOnboardingBannerShown', () => {
    expect(analytics).not.toHaveProperty('trackOnboardingBannerShown')
  })
  it('does not export trackOnboardingBannerCtaClick', () => {
    expect(analytics).not.toHaveProperty('trackOnboardingBannerCtaClick')
  })
  it('does not export trackOnboardingBannerDismiss', () => {
    expect(analytics).not.toHaveProperty('trackOnboardingBannerDismiss')
  })
  it('does not export trackOnboardingMilestoneReached', () => {
    expect(analytics).not.toHaveProperty('trackOnboardingMilestoneReached')
  })
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

describe('GA4 standard event names', () => {
  it('trackBrandDetailViewed sends view_item with item_id', () => {
    trackBrandDetailViewed('my-brand', 'search')
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'view_item', {
      item_id: 'my-brand',
      source: 'search',
    })
  })

  it('trackBrandCardClicked sends select_item with item_id', () => {
    trackBrandCardClicked('my-brand', 'accessories', 3)
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'select_item', {
      item_id: 'my-brand',
      category: 'accessories',
      position_in_grid: 3,
    })
  })

  it('trackSearchExecuted sends search with search_term', () => {
    trackSearchExecuted('台灣品牌', 5)
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'search', {
      search_term: '台灣品牌',
      result_count: 5,
      has_results: true,
    })
  })
})

describe('analytics', () => {
  it('maps brand events to versioned PostHog names without changing GA4', () => {
    trackBrandDetailViewed('my-brand', 'search', 'brand-uuid')

    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'view_item', {
      item_id: 'my-brand',
      source: 'search',
    })
    expect(mockPostHogCapture).toHaveBeenCalledWith('brand_detail_viewed', {
      brand_id: 'brand-uuid',
      brand_slug: 'my-brand',
      source: 'search',
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
  it('trackBrandDetailViewed sends view_item with source', () => {
    trackBrandDetailViewed('my-brand', 'search')
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'view_item', {
      item_id: 'my-brand',
      source: 'search',
    })
  })

  it('trackBrandDetailViewed defaults source to direct', () => {
    trackBrandDetailViewed('my-brand')
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'view_item', {
      item_id: 'my-brand',
      source: 'direct',
    })
  })

  it('trackBrandCardClicked sends select_item with position', () => {
    trackBrandCardClicked('my-brand', 'accessories', 3)
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'select_item', {
      item_id: 'my-brand',
      category: 'accessories',
      position_in_grid: 3,
    })
  })

  it('trackExternalLinkClicked sends external_link_clicked', () => {
    trackExternalLinkClicked('my-brand', 'website', '/brands/my-brand')
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'external_link_clicked', {
      brand_slug: 'my-brand',
      link_type: 'website',
      referrer_page: '/brands/my-brand',
    })
  })

  it('trackCategoryFilterApplied sends category_filter_applied', () => {
    trackCategoryFilterApplied('accessories')
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'category_filter_applied', {
      category: 'accessories',
    })
  })

  it('trackSearchExecuted sends search with result info', () => {
    trackSearchExecuted('台灣品牌', 5)
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'search', {
      search_term: '台灣品牌',
      result_count: 5,
      has_results: true,
    })
  })

  it('trackSearchExecuted sends has_results=false when count=0', () => {
    trackSearchExecuted('xyz', 0)
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'search', {
      search_term: 'xyz',
      result_count: 0,
      has_results: false,
    })
  })

  it('trackSearchResultClicked sends search_result_clicked', () => {
    trackSearchResultClicked('台灣', 2)
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'search_result_clicked', {
      query: '台灣',
      position_in_results: 2,
    })
  })

  it('trackSubmissionFormOpened sends submission_form_opened', () => {
    trackSubmissionFormOpened('hero_cta')
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'submission_form_opened', {
      source: 'hero_cta',
      intent: 'recommend',
    })
  })

  it('preserves quick-owner GA4 taxonomy while normalizing PostHog intent', () => {
    trackSubmissionFormOpened('quick', 'owner')

    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'submission_form_opened', {
      source: 'quick',
      intent: 'owner',
    })
    expect(mockPostHogCapture).toHaveBeenCalledWith('submission_form_opened', {
      source: 'quick',
      intent: 'owner_claim',
    })
  })

  it('trackSubmissionFormStepCompleted uses string step constant', () => {
    trackSubmissionFormStepCompleted('brand_info')
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'submission_form_step_completed', {
      step: 'brand_info',
    })
  })

  it('trackSubmissionCompleted sends all required properties', () => {
    trackSubmissionCompleted('My Brand', 'accessories', true, 120)
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'submission_completed', {
      brand_name: 'My Brand',
      category: 'accessories',
      has_logo: true,
      time_spent_seconds: 120,
      intent: 'recommend',
      guest_submission: false,
    })
  })

  it('trackSubmissionFormAbandoned sends abandonment event', () => {
    trackSubmissionFormAbandoned('brand_info', 45)
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'submission_form_abandoned', {
      last_step_completed: 'brand_info',
      time_spent_seconds: 45,
    })
  })

  it('does not send events from protected paths', () => {
    window.history.replaceState({}, '', '/zh-TW/dashboard/brands')

    trackBrandDetailViewed('private-brand')

    expect(mockSendGAEvent).not.toHaveBeenCalled()
  })

  it('trackBrandPageShared is a stub that does nothing', () => {
    expect(() => trackBrandPageShared('my-brand')).not.toThrow()
  })

  it('trackGalleryPhotoView sends gallery_photo_view event', () => {
    trackGalleryPhotoView('my-brand', 2)
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'gallery_photo_view', {
      brand_slug: 'my-brand',
      photo_index: 2,
    })
  })

  it('trackSearchNoResults sends search_no_results event', () => {
    trackSearchNoResults('xyz')
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'search_no_results', {
      search_term: 'xyz',
    })
  })

  it('trackSearchSuggestionSelect sends search_suggestion_select event', () => {
    trackSearchSuggestionSelect('my-brand')
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'search_suggestion_select', {
      brand_slug: 'my-brand',
    })
  })

  it('does not throw when gtag fails', () => {
    mockSendGAEvent.mockImplementation(() => {
      throw new Error('gtag not loaded')
    })
    expect(() => trackBrandDetailViewed('test')).not.toThrow()
  })
})

describe('trackSignUp', () => {
  it('sends sign_up event with method', () => {
    trackSignUp('google')
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'sign_up', {
      method: 'google',
    })
  })
})

describe('UTM on conversion events', () => {
  beforeEach(() => {
    window.history.pushState(
      {},
      '',
      '/?utm_source=google&utm_medium=cpc&utm_campaign=launch'
    )
  })

  it('trackSignUp includes UTM params', () => {
    trackSignUp('google')
    expect(mockSendGAEvent).toHaveBeenCalledWith(
      'event',
      'sign_up',
      expect.objectContaining({
        method: 'google',
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'launch',
      })
    )
  })

  it('trackSubmissionCompleted includes UTM params', () => {
    trackSubmissionCompleted('test-brand', 'accessories', true, 120)
    expect(mockSendGAEvent).toHaveBeenCalledWith(
      'event',
      'submission_completed',
      expect.objectContaining({
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'launch',
      })
    )
  })
})

describe('trackLogin', () => {
  it('sends login event with method', () => {
    trackLogin('google')
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'login', {
      method: 'google',
    })
  })
})

describe('trackViewItemList', () => {
  it('sends view_item_list with list name and item count', () => {
    trackViewItemList('directory', 12)
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'view_item_list', {
      item_list_name: 'directory',
      item_count: 12,
    })
  })

  it('sends view_item_list for category pages', () => {
    trackViewItemList('category:food', 5)
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'view_item_list', {
      item_list_name: 'category:food',
      item_count: 5,
    })
  })
})
