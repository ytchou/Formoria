// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockSendGAEvent = vi.fn()
vi.mock('@next/third-parties/google', () => ({
  sendGAEvent: (...args: unknown[]) => mockSendGAEvent(...args),
}))

import {
  trackBrandDetailViewed,
  trackBrandCardClicked,
  trackExternalLinkClicked,
  trackCategoryFilterApplied,
  trackSearchExecuted,
  trackSearchResultClicked,
  trackSearchNoResults,
  trackSearchSuggestionSelect,
  trackFilterSearch,
  trackSubmissionFormOpened,
  trackSubmissionFormStepCompleted,
  trackSubmissionCompleted,
  trackSubmissionFormAbandoned,
  trackGalleryPhotoView,
  trackSessionStart,
  trackBrandPageShared,
  trackListingSharedByOwner,
} from './analytics'

beforeEach(() => {
  mockSendGAEvent.mockClear()
})

describe('analytics', () => {
  it('trackBrandDetailViewed sends brand_detail_viewed with source', () => {
    trackBrandDetailViewed('my-brand', 'search')
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'brand_detail_viewed', {
      brand_slug: 'my-brand',
      source: 'search',
    })
  })

  it('trackBrandDetailViewed defaults source to direct', () => {
    trackBrandDetailViewed('my-brand')
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'brand_detail_viewed', {
      brand_slug: 'my-brand',
      source: 'direct',
    })
  })

  it('trackBrandCardClicked sends brand_card_clicked with position', () => {
    trackBrandCardClicked('my-brand', 'accessories', 3)
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'brand_card_clicked', {
      brand_slug: 'my-brand',
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

  it('trackSearchExecuted sends search_executed with result info', () => {
    trackSearchExecuted('台灣品牌', 5)
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'search_executed', {
      query: '台灣品牌',
      result_count: 5,
      has_results: true,
    })
  })

  it('trackSearchExecuted sends has_results=false when count=0', () => {
    trackSearchExecuted('xyz', 0)
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'search_executed', {
      query: 'xyz',
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
    })
  })

  it('trackSubmissionFormAbandoned sends abandonment event', () => {
    trackSubmissionFormAbandoned('brand_info', 45)
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'submission_form_abandoned', {
      last_step_completed: 'brand_info',
      time_spent_seconds: 45,
    })
  })

  it('trackSessionStart sends session_start with returning info', () => {
    trackSessionStart(true, 3)
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'session_start', {
      is_returning: true,
      days_since_last_visit: 3,
    })
  })

  it('trackSessionStart sends session_start with null days on first visit', () => {
    trackSessionStart(false, null)
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'session_start', {
      is_returning: false,
      days_since_last_visit: null,
    })
  })

  it('trackBrandPageShared is a stub that does nothing', () => {
    expect(() => trackBrandPageShared('my-brand')).not.toThrow()
  })

  it('trackListingSharedByOwner is a stub that does nothing', () => {
    expect(() => trackListingSharedByOwner('my-brand')).not.toThrow()
  })

  it('trackFilterSearch sends filter_search event', () => {
    trackFilterSearch(5)
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'filter_search', {
      query_length: 5,
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

  it('does not throw when sendGAEvent fails', () => {
    mockSendGAEvent.mockImplementation(() => {
      throw new Error('gtag not loaded')
    })
    expect(() => trackBrandDetailViewed('test')).not.toThrow()
  })
})
