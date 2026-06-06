import { sendGAEvent } from '@next/third-parties/google'

function safeGAEvent(...args: Parameters<typeof sendGAEvent>) {
  try {
    if (typeof window === 'undefined') return
    // Ensure dataLayer exists before GA script loads.
    // window.dataLayer is typed by @next/third-parties as Object[] | undefined.
    window.dataLayer = window.dataLayer ?? []
    sendGAEvent(...args)
  } catch {
    // Silently swallow — analytics must never break the app
  }
}

export const SUBMISSION_STEP_NAMES = {
  0: 'brand_info',
  1: 'category_select',
  2: 'links',
  3: 'review',
} as const

export type SubmissionStepName = (typeof SUBMISSION_STEP_NAMES)[keyof typeof SUBMISSION_STEP_NAMES]

export function trackBrandDetailViewed(
  slug: string,
  source: 'search' | 'category' | 'directory' | 'direct' | 'recommendation' = 'direct'
) {
  safeGAEvent('event', 'brand_detail_viewed', { brand_slug: slug, source })
}

export function trackBrandCardClicked(
  slug: string,
  category: string | null | undefined,
  positionInGrid: number
) {
  safeGAEvent('event', 'brand_card_clicked', {
    brand_slug: slug,
    category: category ?? null,
    position_in_grid: positionInGrid,
  })
}

export function trackExternalLinkClicked(
  slug: string,
  linkType: string,
  referrerPage: string
) {
  safeGAEvent('event', 'external_link_clicked', {
    brand_slug: slug,
    link_type: linkType,
    referrer_page: referrerPage,
  })
}

export function trackCategoryFilterApplied(category: string) {
  safeGAEvent('event', 'category_filter_applied', { category })
}

export function trackSearchExecuted(query: string, resultCount: number) {
  safeGAEvent('event', 'search_executed', {
    query,
    result_count: resultCount,
    has_results: resultCount > 0,
  })
}

export function trackSearchResultClicked(query: string, positionInResults: number) {
  safeGAEvent('event', 'search_result_clicked', {
    query,
    position_in_results: positionInResults,
  })
}

export function trackSubmissionFormOpened(
  source: 'header_cta' | 'hero_cta' | 'footer_link' = 'hero_cta'
) {
  safeGAEvent('event', 'submission_form_opened', { source })
}

export function trackSubmissionFormStepCompleted(step: SubmissionStepName) {
  safeGAEvent('event', 'submission_form_step_completed', { step })
}

export function trackSubmissionCompleted(
  brandName: string,
  category: string,
  hasLogo: boolean,
  timeSpentSeconds: number
) {
  safeGAEvent('event', 'submission_completed', {
    brand_name: brandName,
    category,
    has_logo: hasLogo,
    time_spent_seconds: timeSpentSeconds,
  })
}

export function trackSubmissionFormAbandoned(
  lastStepCompleted: SubmissionStepName,
  timeSpentSeconds: number
) {
  safeGAEvent('event', 'submission_form_abandoned', {
    last_step_completed: lastStepCompleted,
    time_spent_seconds: timeSpentSeconds,
  })
}

export function trackSessionStart(
  isReturning: boolean,
  daysSinceLastVisit: number | null
) {
  safeGAEvent('event', 'session_start', {
    is_returning: isReturning,
    days_since_last_visit: daysSinceLastVisit,
  })
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
  safeGAEvent('event', 'filter_search', { query_length: queryLength })
}

export function trackGalleryPhotoView(slug: string, index: number) {
  safeGAEvent('event', 'gallery_photo_view', {
    brand_slug: slug,
    photo_index: index,
  })
}

export function trackSearchSuggestionSelect(slug: string) {
  safeGAEvent('event', 'search_suggestion_select', {
    brand_slug: slug,
  })
}

export function trackSearchNoResults(searchTerm: string) {
  safeGAEvent('event', 'search_no_results', { search_term: searchTerm })
}
