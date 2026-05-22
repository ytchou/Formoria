import { sendGAEvent } from '@next/third-parties/google'

export const SUBMISSION_STEP_NAMES = {
  0: 'brand_info',
  1: 'category_select',
  2: 'links',
  3: 'review',
} as const

export type SubmissionStepName = (typeof SUBMISSION_STEP_NAMES)[keyof typeof SUBMISSION_STEP_NAMES]

export function trackBrandDetailViewed(
  slug: string,
  source: 'search' | 'category' | 'direct' | 'recommendation' = 'direct'
) {
  try {
    sendGAEvent('event', 'brand_detail_viewed', { brand_slug: slug, source })
  } catch {
    // Graceful degradation
  }
}

export function trackBrandCardClicked(
  slug: string,
  category: string | null | undefined,
  positionInGrid: number
) {
  try {
    sendGAEvent('event', 'brand_card_clicked', {
      brand_slug: slug,
      category: category ?? null,
      position_in_grid: positionInGrid,
    })
  } catch {
    // Graceful degradation
  }
}

export function trackExternalLinkClicked(
  slug: string,
  linkType: string,
  referrerPage: string
) {
  try {
    sendGAEvent('event', 'external_link_clicked', {
      brand_slug: slug,
      link_type: linkType,
      referrer_page: referrerPage,
    })
  } catch {
    // Graceful degradation
  }
}

export function trackCategoryFilterApplied(category: string) {
  try {
    sendGAEvent('event', 'category_filter_applied', { category })
  } catch {
    // Graceful degradation
  }
}

export function trackSearchExecuted(query: string, resultCount: number) {
  try {
    sendGAEvent('event', 'search_executed', {
      query,
      result_count: resultCount,
      has_results: resultCount > 0,
    })
  } catch {
    // Graceful degradation
  }
}

export function trackSearchResultClicked(query: string, positionInResults: number) {
  try {
    sendGAEvent('event', 'search_result_clicked', {
      query,
      position_in_results: positionInResults,
    })
  } catch {
    // Graceful degradation
  }
}

export function trackSubmissionFormOpened(
  source: 'header_cta' | 'hero_cta' | 'footer_link' = 'hero_cta'
) {
  try {
    sendGAEvent('event', 'submission_form_opened', { source })
  } catch {
    // Graceful degradation
  }
}

export function trackSubmissionFormStepCompleted(step: SubmissionStepName) {
  try {
    sendGAEvent('event', 'submission_form_step_completed', { step })
  } catch {
    // Graceful degradation
  }
}

export function trackSubmissionCompleted(
  brandName: string,
  category: string,
  hasLogo: boolean,
  timeSpentSeconds: number
) {
  try {
    sendGAEvent('event', 'submission_completed', {
      brand_name: brandName,
      category,
      has_logo: hasLogo,
      time_spent_seconds: timeSpentSeconds,
    })
  } catch {
    // Graceful degradation
  }
}

export function trackSubmissionFormAbandoned(
  lastStepCompleted: SubmissionStepName,
  timeSpentSeconds: number
) {
  try {
    sendGAEvent('event', 'submission_form_abandoned', {
      last_step_completed: lastStepCompleted,
      time_spent_seconds: timeSpentSeconds,
    })
  } catch {
    // Graceful degradation
  }
}

export function trackSessionStart(
  isReturning: boolean,
  daysSinceLastVisit: number | null
) {
  try {
    sendGAEvent('event', 'session_start', {
      is_returning: isReturning,
      days_since_last_visit: daysSinceLastVisit,
    })
  } catch {
    // Graceful degradation
  }
}

// Stub — share UI doesn't exist yet
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function trackBrandPageShared(_slug: string) {
  // stub
}

// Stub — no owner share UI exists
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function trackListingSharedByOwner(_slug: string) {
  // stub
}

// Keep as-is: non-spec extras with useful signal
export function trackFilterSearch(queryLength: number) {
  try {
    sendGAEvent('event', 'filter_search', { query_length: queryLength })
  } catch {
    // Graceful degradation
  }
}

export function trackGalleryPhotoView(slug: string, index: number) {
  try {
    sendGAEvent('event', 'gallery_photo_view', {
      brand_slug: slug,
      photo_index: index,
    })
  } catch {
    // Graceful degradation
  }
}

export function trackSearchSuggestionSelect(slug: string) {
  try {
    sendGAEvent('event', 'search_suggestion_select', {
      brand_slug: slug,
    })
  } catch {
    // Graceful degradation
  }
}

export function trackSearchNoResults(searchTerm: string) {
  try {
    sendGAEvent('event', 'search_no_results', { search_term: searchTerm })
  } catch {
    // Graceful degradation
  }
}
