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

  it('trackBrandPageShared calls PostHog with brand_page_shared event', () => {
    trackBrandPageShared('my-brand', 'brand-uuid', 'copy_link')
    expect(mockPostHogCapture).toHaveBeenCalledWith('brand_page_shared', {
      brand_id: 'brand-uuid',
      brand_slug: 'my-brand',
      method: 'copy_link',
    })
  })

  it('trackBrandPageShared works with only slug (backward-compatible call site)', () => {
    trackBrandPageShared('my-brand')
    expect(mockPostHogCapture).toHaveBeenCalledWith('brand_page_shared', {
      brand_id: undefined,
      brand_slug: 'my-brand',
      method: undefined,
    })
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

describe('trackHeroCategoryClicked', () => {
  it('calls PostHog with hero_category_clicked and correct properties', () => {
    trackHeroCategoryClicked('fashion', '/brands?category=fashion')
    expect(mockPostHogCapture).toHaveBeenCalledWith('hero_category_clicked', {
      category: 'fashion',
      destination_url: '/brands?category=fashion',
    })
  })
})

describe('trackDirectorySortChanged', () => {
  it('calls PostHog with directory_sort_changed and correct properties', () => {
    trackDirectorySortChanged('name_asc', 'newest')
    expect(mockPostHogCapture).toHaveBeenCalledWith('directory_sort_changed', {
      sort_value: 'name_asc',
      previous_sort: 'newest',
    })
  })
})

describe('trackDirectoryPageNavigated', () => {
  it('calls PostHog with directory_page_navigated and correct properties', () => {
    trackDirectoryPageNavigated(3, 'next', 10)
    expect(mockPostHogCapture).toHaveBeenCalledWith('directory_page_navigated', {
      page_number: 3,
      direction: 'next',
      total_pages: 10,
    })
  })
})

describe('trackSubcategoryFilterApplied', () => {
  it('calls PostHog with subcategory_filter_applied and correct properties', () => {
    trackSubcategoryFilterApplied('sneakers', 'fashion')
    expect(mockPostHogCapture).toHaveBeenCalledWith('subcategory_filter_applied', {
      subcategory: 'sneakers',
      parent_category: 'fashion',
    })
  })
})

describe('trackPriceFilterApplied', () => {
  it('calls PostHog with price_filter_applied and correct properties', () => {
    trackPriceFilterApplied('under_1000')
    expect(mockPostHogCapture).toHaveBeenCalledWith('price_filter_applied', {
      price_range: 'under_1000',
    })
  })
})

describe('trackVerificationFilterApplied', () => {
  it('calls PostHog with verification_filter_applied and correct properties', () => {
    trackVerificationFilterApplied('verified')
    expect(mockPostHogCapture).toHaveBeenCalledWith('verification_filter_applied', {
      status: 'verified',
    })
  })
})

describe('trackFilterCleared', () => {
  it('calls PostHog with filter_cleared and all optional properties', () => {
    trackFilterCleared('single', 'category', 'fashion')
    expect(mockPostHogCapture).toHaveBeenCalledWith('filter_cleared', {
      clear_type: 'single',
      filter_type: 'category',
      filter_value: 'fashion',
    })
  })

  it('calls PostHog with filter_cleared with only required property', () => {
    trackFilterCleared('all')
    expect(mockPostHogCapture).toHaveBeenCalledWith('filter_cleared', {
      clear_type: 'all',
      filter_type: undefined,
      filter_value: undefined,
    })
  })
})

describe('trackLanguageSwitched', () => {
  it('calls PostHog with language_switched and correct properties', () => {
    trackLanguageSwitched('zh-TW', 'en', 'header')
    expect(mockPostHogCapture).toHaveBeenCalledWith('language_switched', {
      from_locale: 'zh-TW',
      to_locale: 'en',
      location: 'header',
    })
  })
})

describe('trackBrandSaved', () => {
  it('calls PostHog with brand_saved and correct properties', () => {
    trackBrandSaved('brand-uuid', 'my-brand', 'brand_card')
    expect(mockPostHogCapture).toHaveBeenCalledWith('brand_saved', {
      brand_id: 'brand-uuid',
      brand_slug: 'my-brand',
      location: 'brand_card',
    })
  })
})

describe('trackBrandUnsaved', () => {
  it('calls PostHog with brand_unsaved and correct properties', () => {
    trackBrandUnsaved('brand-uuid', 'my-brand', 'brand_detail')
    expect(mockPostHogCapture).toHaveBeenCalledWith('brand_unsaved', {
      brand_id: 'brand-uuid',
      brand_slug: 'my-brand',
      location: 'brand_detail',
    })
  })
})

describe('trackRecommendationBrandClicked', () => {
  it('calls PostHog with recommendation_brand_clicked and correct properties', () => {
    trackRecommendationBrandClicked('brand-uuid', 'target-brand', 'source-brand', 2)
    expect(mockPostHogCapture).toHaveBeenCalledWith('recommendation_brand_clicked', {
      brand_id: 'brand-uuid',
      brand_slug: 'target-brand',
      source_brand_slug: 'source-brand',
      position: 2,
    })
  })
})

describe('trackRecommendationSectionViewed', () => {
  it('calls PostHog with recommendation_section_viewed and correct properties', () => {
    trackRecommendationSectionViewed('source-brand', 5)
    expect(mockPostHogCapture).toHaveBeenCalledWith('recommendation_section_viewed', {
      source_brand_slug: 'source-brand',
      recommendation_count: 5,
    })
  })
})

describe('trackGalleryCompleted', () => {
  it('calls PostHog with gallery_completed and correct properties', () => {
    trackGalleryCompleted('brand-uuid', 'my-brand', 8)
    expect(mockPostHogCapture).toHaveBeenCalledWith('gallery_completed', {
      brand_id: 'brand-uuid',
      brand_slug: 'my-brand',
      image_count: 8,
    })
  })
})

describe('trackFaqItemExpanded', () => {
  it('calls PostHog with faq_item_expanded and correct properties', () => {
    trackFaqItemExpanded('my-brand', 2)
    expect(mockPostHogCapture).toHaveBeenCalledWith('faq_item_expanded', {
      brand_slug: 'my-brand',
      item_index: 2,
    })
  })
})

describe('trackSubmissionPathSelected', () => {
  it('calls PostHog with submission_path_selected and correct properties', () => {
    trackSubmissionPathSelected('recommend', true)
    expect(mockPostHogCapture).toHaveBeenCalledWith(
      'submission_path_selected',
      expect.objectContaining({
        path: 'recommend',
        is_authenticated: true,
      })
    )
  })

  it('includes UTM params when present', () => {
    window.history.pushState({}, '', '/?utm_source=google&utm_medium=cpc')
    trackSubmissionPathSelected('owner_claim', false)
    expect(mockPostHogCapture).toHaveBeenCalledWith(
      'submission_path_selected',
      expect.objectContaining({
        path: 'owner_claim',
        is_authenticated: false,
        utm_source: 'google',
        utm_medium: 'cpc',
      })
    )
  })
})

describe('trackNewsletterSubscribed', () => {
  it('calls PostHog with newsletter_subscribed and correct properties', () => {
    trackNewsletterSubscribed(['fashion', 'food'], true)
    expect(mockPostHogCapture).toHaveBeenCalledWith(
      'newsletter_subscribed',
      expect.objectContaining({
        interests: ['fashion', 'food'],
        has_email: true,
      })
    )
  })

  it('includes UTM params when present', () => {
    window.history.pushState({}, '', '/?utm_source=newsletter')
    trackNewsletterSubscribed([], false)
    expect(mockPostHogCapture).toHaveBeenCalledWith(
      'newsletter_subscribed',
      expect.objectContaining({
        interests: [],
        has_email: false,
        utm_source: 'newsletter',
      })
    )
  })
})

describe('trackBrandClaimStarted', () => {
  it('calls PostHog with brand_claim_started and correct properties', () => {
    trackBrandClaimStarted('brand-uuid', 'my-brand', false)
    expect(mockPostHogCapture).toHaveBeenCalledWith('brand_claim_started', {
      brand_id: 'brand-uuid',
      brand_slug: 'my-brand',
      is_authenticated: false,
    })
  })
})

describe('MIT tiering analytics', () => {
  it('tracks mit_declared with snake_case props', () => {
    trackMitDeclared('brand-1', 'acme', 'most')
    expect(mockPostHogCapture).toHaveBeenCalledWith(
      'mit_declared',
      expect.objectContaining({
        brand_id: 'brand-1',
        brand_slug: 'acme',
        declared_scope: 'most',
      })
    )
  })

  it('tracks origin_evidence_submitted', () => {
    trackOriginEvidenceSubmitted('brand-1', 'acme', 'contradicts')
    expect(mockPostHogCapture).toHaveBeenCalledWith(
      'origin_evidence_submitted',
      expect.objectContaining({
        brand_id: 'brand-1',
        brand_slug: 'acme',
        stance: 'contradicts',
      })
    )
  })
})

describe('trackBrandClaimFormSubmitted', () => {
  it('calls PostHog with brand_claim_form_submitted and correct properties', () => {
    trackBrandClaimFormSubmitted('brand-uuid', 'my-brand', ['business_license', 'social_media'])
    expect(mockPostHogCapture).toHaveBeenCalledWith('brand_claim_form_submitted', {
      brand_id: 'brand-uuid',
      brand_slug: 'my-brand',
      proof_types: ['business_license', 'social_media'],
    })
  })
})

describe('trackBrandReported', () => {
  it('calls PostHog with brand_reported and correct properties', () => {
    trackBrandReported('my-brand', 'incorrect_info', 'consumer')
    expect(mockPostHogCapture).toHaveBeenCalledWith('brand_reported', {
      brand_slug: 'my-brand',
      reason: 'incorrect_info',
      reporter_role: 'consumer',
    })
  })
})

describe('trackCtaClicked', () => {
  it('calls PostHog with cta_clicked and correct properties', () => {
    trackCtaClicked('submit_brand', 'hero', '/submit', '/')
    expect(mockPostHogCapture).toHaveBeenCalledWith('cta_clicked', {
      cta_name: 'submit_brand',
      cta_location: 'hero',
      destination_url: '/submit',
      page_url: '/',
    })
  })
})

describe('trackSubmissionFormErrorShown', () => {
  it('calls PostHog with submission_form_error_shown and correct properties', () => {
    trackSubmissionFormErrorShown('brand_name', 'required', 'step_1')
    expect(mockPostHogCapture).toHaveBeenCalledWith('submission_form_error_shown', {
      field: 'brand_name',
      error_type: 'required',
      step: 'step_1',
    })
  })
})

describe('trackApiErrorShown', () => {
  it('calls PostHog with api_error_shown and correct properties', () => {
    trackApiErrorShown('/api/brands', 500, 'submit_form')
    expect(mockPostHogCapture).toHaveBeenCalledWith('api_error_shown', {
      endpoint: '/api/brands',
      status_code: 500,
      user_action: 'submit_form',
    })
  })
})
