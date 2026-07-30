import { capturePostHogEvent, resetPostHogUser } from './analytics/posthog-provider'

const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const

const UTM_FIRST_TOUCH_KEY = 'formoria_utm_first_touch'
const UTM_LAST_TOUCH_KEY = 'formoria_utm_last_touch'

const PROTECTED_ANALYTICS_SEGMENTS = ['/admin', '/dashboard', '/auth'] as const

function stripLocale(pathname: string): string {
  return pathname.replace(/^\/(?:zh-TW|en)(?=\/|$)/, '') || '/'
}

export function isPublicAnalyticsPath(pathname: string): boolean {
  const pathWithoutLocale = stripLocale(pathname)

  return !PROTECTED_ANALYTICS_SEGMENTS.some(
    (segment) =>
      pathWithoutLocale === segment || pathWithoutLocale.startsWith(`${segment}/`),
  )
}

function safeGAEvent(
  command: 'event',
  eventName: string,
  params?: Record<string, unknown>,
) {
  try {
    if (typeof window === 'undefined') return
    if (!isPublicAnalyticsPath(window.location.pathname)) return
    window.gtag?.(command, eventName, params)
  } catch {
    // Silently swallow — analytics must never break the app
  }
}

export function getUtmParams(search: string): Record<string, string> {
  const params = new URLSearchParams(search)
  const utmParams: Record<string, string> = {}

  for (const key of UTM_KEYS) {
    const value = params.get(key)
    if (value !== null) {
      utmParams[key] = value
    }
  }

  return utmParams
}

export function getContentGroup(pathname: string): string {
  const pathWithoutLocale = stripLocale(pathname)

  if (pathWithoutLocale === '/' || pathWithoutLocale === '/brands') {
    return 'directory'
  }

  if (pathWithoutLocale.startsWith('/brands/')) {
    return 'brand_detail'
  }

  if (pathWithoutLocale === '/submit' || pathWithoutLocale.startsWith('/submit/')) {
    return 'submission'
  }

  if (pathWithoutLocale === '/admin' || pathWithoutLocale.startsWith('/admin/')) {
    return 'admin'
  }

  if (pathWithoutLocale === '/about') {
    return 'about'
  }

  return 'other'
}

function flattenTouchPoint(
  prefix: 'first_touch' | 'last_touch',
  params: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      `${prefix}_${key.replace(/^utm_/, '')}`,
      value,
    ])
  )
}

function readStoredUtmParams(key: string): Record<string, string> | null {
  const value = window.localStorage.getItem(key)
  if (!value) return null

  try {
    return JSON.parse(value) as Record<string, string>
  } catch {
    return null
  }
}

export function persistUtmTouchPoints(
  utmParams: Record<string, string>
): Record<string, string> | null {
  try {
    const hasUtmParams = Object.keys(utmParams).length > 0
    const storedFirstTouch = readStoredUtmParams(UTM_FIRST_TOUCH_KEY)
    const storedLastTouch = readStoredUtmParams(UTM_LAST_TOUCH_KEY)

    if (!hasUtmParams && !storedFirstTouch && !storedLastTouch) {
      return null
    }

    const firstTouch = storedFirstTouch ?? utmParams
    const lastTouch = hasUtmParams ? utmParams : storedLastTouch

    if (hasUtmParams) {
      if (!storedFirstTouch) {
        window.localStorage.setItem(UTM_FIRST_TOUCH_KEY, JSON.stringify(utmParams))
      }
      window.localStorage.setItem(UTM_LAST_TOUCH_KEY, JSON.stringify(utmParams))
    }

    return {
      ...flattenTouchPoint('first_touch', firstTouch),
      ...(lastTouch ? flattenTouchPoint('last_touch', lastTouch) : {}),
    }
  } catch {
    return Object.keys(utmParams).length > 0
      ? {
          ...flattenTouchPoint('first_touch', utmParams),
          ...flattenTouchPoint('last_touch', utmParams),
        }
      : null
  }
}

export function trackBrandDetailViewed(
  slug: string,
  source: 'search' | 'category' | 'directory' | 'direct' | 'recommendation' = 'direct',
  brandId?: string,
) {
  safeGAEvent('event', 'view_item', { item_id: slug, source })
  if (brandId) {
    capturePostHogEvent('brand_detail_viewed', {
      brand_id: brandId,
      brand_slug: slug,
      source,
    })
  }
}

export function trackBrandCardClicked(
  slug: string,
  category: string | null | undefined,
  positionInGrid: number,
  brandId?: string,
) {
  safeGAEvent('event', 'select_item', {
    item_id: slug,
    category: category ?? null,
    position_in_grid: positionInGrid,
  })
  if (brandId) {
    capturePostHogEvent('brand_card_clicked', {
      brand_id: brandId,
      brand_slug: slug,
      category: category ?? null,
      position_in_grid: positionInGrid,
    })
  }
}

export function trackExternalLinkClicked(
  slug: string,
  linkType: string,
  referrerPage: string,
  brandId?: string,
) {
  safeGAEvent('event', 'external_link_clicked', {
    brand_slug: slug,
    link_type: linkType,
    referrer_page: referrerPage,
  })
  if (brandId) {
    capturePostHogEvent('external_link_clicked', {
      brand_id: brandId,
      brand_slug: slug,
      link_type: linkType,
    })
  }
}

export function trackCategoryFilterApplied(category: string) {
  safeGAEvent('event', 'category_filter_applied', { category })
  capturePostHogEvent('category_filter_applied', { category })
}

// Raw query text is deliberately never sent to either destination — the privacy policy
// promises search text is excluded from analytics events. `query_length` preserves the
// useful signal (are people typing long/short queries, and do they find anything) without
// the text itself. This drops GA4's built-in site-search term report by design.
export function trackSearchExecuted(query: string, resultCount: number) {
  safeGAEvent('event', 'search', {
    query_length: query.length,
    result_count: resultCount,
    has_results: resultCount > 0,
  })
  capturePostHogEvent('brand_search_executed', {
    query_length: query.length,
    result_count: resultCount,
    has_results: resultCount > 0,
  })
}

export function trackSearchResultClicked(
  query: string,
  positionInResults: number,
  brandId?: string,
  brandSlug?: string,
) {
  safeGAEvent('event', 'search_result_clicked', {
    query_length: query.length,
    position_in_results: positionInResults,
  })
  if (brandId && brandSlug) {
    capturePostHogEvent('search_result_clicked', {
      query_length: query.length,
      position_in_results: positionInResults,
      brand_id: brandId,
      brand_slug: brandSlug,
    })
  }
}

export function trackSubmissionFormOpened(
  source: 'header_cta' | 'hero_cta' | 'footer_link' | 'quick' = 'hero_cta',
  intent: 'recommend' | 'owner_claim' | 'owner' = 'recommend'
) {
  safeGAEvent('event', 'submission_form_opened', { source, intent })
  capturePostHogEvent('submission_form_opened', {
    source,
    intent: intent === 'owner' ? 'owner_claim' : intent,
  })
}

export function trackSubmissionFormStepCompleted(step: string) {
  safeGAEvent('event', 'submission_form_step_completed', { step })
  capturePostHogEvent('submission_form_step_completed', { step })
}

export function trackSubmissionCompleted(
  brandName: string,
  category: string,
  hasLogo: boolean,
  timeSpentSeconds: number,
  intent: 'recommend' | 'owner_claim' = 'recommend',
  guestSubmission = false,
) {
  const utmParams =
    typeof window !== 'undefined' ? getUtmParams(window.location.search) : {}

  safeGAEvent('event', 'submission_completed', {
    brand_name: brandName,
    category,
    has_logo: hasLogo,
    time_spent_seconds: timeSpentSeconds,
    intent,
    guest_submission: guestSubmission,
    ...utmParams,
  })
  capturePostHogEvent('submission_completed', {
    category,
    has_logo: hasLogo,
    time_spent_seconds: timeSpentSeconds,
    intent,
    guest_submission: guestSubmission,
    ...utmParams,
  })
}

export function trackSubmissionFormAbandoned(
  lastStepCompleted: string,
  timeSpentSeconds: number
) {
  safeGAEvent('event', 'submission_form_abandoned', {
    last_step_completed: lastStepCompleted,
    time_spent_seconds: timeSpentSeconds,
  })
  capturePostHogEvent('submission_form_abandoned', {
    last_step_completed: lastStepCompleted,
    time_spent_seconds: timeSpentSeconds,
  })
}

/** Share channels offered by the brand share dialog. Adding a channel here is the
 *  compile-time contract the dialog is checked against. */
// 'x' was retired in DEV-1242; historical brand_page_shared events retain method: 'x'.
export type ShareChannel =
  | 'native'
  | 'copy_link'
  | 'line'
  | 'threads'
  | 'facebook'
  | 'instagram'

export function trackBrandPageShared(
  slug: string,
  brandId?: string,
  method?: ShareChannel
) {
  capturePostHogEvent('brand_page_shared', {
    brand_id: brandId,
    brand_slug: slug,
    method,
  })
}

export function trackGalleryPhotoView(slug: string, index: number, brandId?: string) {
  safeGAEvent('event', 'gallery_photo_view', {
    brand_slug: slug,
    photo_index: index,
  })
  if (brandId) {
    capturePostHogEvent('gallery_photo_viewed', {
      brand_id: brandId,
      brand_slug: slug,
      photo_index: index,
    })
  }
}

export function trackSearchSuggestionSelect(slug: string, brandId?: string) {
  safeGAEvent('event', 'search_suggestion_select', {
    brand_slug: slug,
  })
  if (brandId) {
    capturePostHogEvent('search_suggestion_selected', {
      brand_id: brandId,
      brand_slug: slug,
    })
  }
}

export function trackSearchNoResults(searchTerm: string) {
  safeGAEvent('event', 'search_no_results', { query_length: searchTerm.length })
  capturePostHogEvent('brand_search_empty', { query_length: searchTerm.length })
}

export function trackSignUp(method: string) {
  const utmParams =
    typeof window !== 'undefined' ? getUtmParams(window.location.search) : {}

  safeGAEvent('event', 'sign_up', {
    method,
    ...utmParams,
  })
  capturePostHogEvent('user_signed_up', { method, ...utmParams })
}

export function trackLogin(method: string) {
  safeGAEvent('event', 'login', { method })
  capturePostHogEvent('user_logged_in', { method })
}

// Routed through the provider shim rather than `posthog-js` directly: the sign-out
// control lives in the globally hydrated nav, and a static SDK import there would
// pull the whole bundle into the shared chunk.
export function trackSignOut() {
  // Emitted through the reset itself: a separate capture beforehand is wiped by the
  // buffer clear when no provider has registered yet.
  resetPostHogUser({ event: 'user_signed_out' })
}

export function trackViewItemList(listName: string, itemCount: number) {
  safeGAEvent('event', 'view_item_list', {
    item_list_name: listName,
    item_count: itemCount,
  })
  capturePostHogEvent('brand_list_viewed', {
    list_name: listName,
    item_count: itemCount,
  })
}

export function trackHeroCategoryClicked(category: string, destinationUrl: string) {
  capturePostHogEvent('hero_category_clicked', { category, destination_url: destinationUrl })
}

export function trackDirectorySortChanged(sortValue: string, previousSort: string) {
  capturePostHogEvent('directory_sort_changed', {
    sort_value: sortValue,
    previous_sort: previousSort,
  })
}

export function trackDirectoryPageNavigated(
  pageNumber: number,
  direction: string,
  totalPages: number,
) {
  capturePostHogEvent('directory_page_navigated', {
    page_number: pageNumber,
    direction,
    total_pages: totalPages,
  })
}

export function trackSubcategoryFilterApplied(subcategory: string, parentCategory: string) {
  capturePostHogEvent('subcategory_filter_applied', {
    subcategory,
    parent_category: parentCategory,
  })
}

export function trackPriceFilterApplied(priceRange: string) {
  capturePostHogEvent('price_filter_applied', { price_range: priceRange })
}

export function trackVerificationFilterApplied(status: string) {
  capturePostHogEvent('verification_filter_applied', { status })
}

export function trackFilterCleared(clearType: string, filterType?: string, filterValue?: string) {
  capturePostHogEvent('filter_cleared', {
    clear_type: clearType,
    filter_type: filterType,
    filter_value: filterValue,
  })
}

export function trackLanguageSwitched(fromLocale: string, toLocale: string, location: string) {
  capturePostHogEvent('language_switched', {
    from_locale: fromLocale,
    to_locale: toLocale,
    location,
  })
}

export function trackBrandSaved(brandId: string, slug: string, location: string) {
  capturePostHogEvent('brand_saved', {
    brand_id: brandId,
    brand_slug: slug,
    location,
  })
}

export function trackBrandUnsaved(brandId: string, slug: string, location: string) {
  capturePostHogEvent('brand_unsaved', {
    brand_id: brandId,
    brand_slug: slug,
    location,
  })
}

export function trackBrandLiked(brandId: string, slug: string) {
  capturePostHogEvent('brand_liked', {
    brand_id: brandId,
    brand_slug: slug,
    location: 'brand_detail',
  })
}

export function trackBrandUnliked(brandId: string, slug: string) {
  capturePostHogEvent('brand_unliked', {
    brand_id: brandId,
    brand_slug: slug,
    location: 'brand_detail',
  })
}

export function trackRecommendationBrandClicked(
  brandId: string,
  slug: string,
  sourceBrandSlug: string,
  position: number,
) {
  capturePostHogEvent('recommendation_brand_clicked', {
    brand_id: brandId,
    brand_slug: slug,
    source_brand_slug: sourceBrandSlug,
    position,
  })
}

export function trackRecommendationSectionViewed(sourceBrandSlug: string, count: number) {
  capturePostHogEvent('recommendation_section_viewed', {
    source_brand_slug: sourceBrandSlug,
    recommendation_count: count,
  })
}

export function trackGalleryCompleted(brandId: string, slug: string, imageCount: number) {
  capturePostHogEvent('gallery_completed', {
    brand_id: brandId,
    brand_slug: slug,
    image_count: imageCount,
  })
}

export function trackFaqItemExpanded(brandSlug: string, index: number) {
  capturePostHogEvent('faq_item_expanded', {
    brand_slug: brandSlug,
    item_index: index,
  })
}

export function trackSubmissionPathSelected(path: string, isAuthenticated: boolean) {
  const utmParams =
    typeof window !== 'undefined' ? getUtmParams(window.location.search) : {}

  capturePostHogEvent('submission_path_selected', {
    path,
    is_authenticated: isAuthenticated,
    ...utmParams,
  })
}

export function trackNewsletterSubscribed(interests: string[], hasEmail: boolean) {
  const utmParams =
    typeof window !== 'undefined' ? getUtmParams(window.location.search) : {}

  capturePostHogEvent('newsletter_subscribed', {
    interests,
    has_email: hasEmail,
    ...utmParams,
  })
}

export function trackBrandClaimStarted(
  brandId: string,
  brandSlug: string,
  isAuthenticated: boolean,
) {
  capturePostHogEvent('brand_claim_started', {
    brand_id: brandId,
    brand_slug: brandSlug,
    is_authenticated: isAuthenticated,
  })
}

export function trackMitDeclared(
  brandId: string,
  brandSlug: string,
  declaredScope: string,
) {
  capturePostHogEvent('mit_declared', {
    brand_id: brandId,
    brand_slug: brandSlug,
    declared_scope: declaredScope,
  })
}

export function trackOriginEvidenceSubmitted(
  brandId: string,
  brandSlug: string,
  stance: string,
) {
  capturePostHogEvent('origin_evidence_submitted', {
    brand_id: brandId,
    brand_slug: brandSlug,
    stance,
  })
}

export function trackBrandClaimFormSubmitted(
  brandId: string,
  brandSlug: string,
  proofTypes: string[],
) {
  capturePostHogEvent('brand_claim_form_submitted', {
    brand_id: brandId,
    brand_slug: brandSlug,
    proof_types: proofTypes,
  })
}

export function trackBrandReported(slug: string, reason: string, reporterRole: string) {
  capturePostHogEvent('brand_reported', {
    brand_slug: slug,
    reason,
    reporter_role: reporterRole,
  })
}

export function trackCorrectionSubmitted(brandId: string, slug: string, field: string) {
  capturePostHogEvent('brand_correction_submitted', {
    brand_id: brandId,
    brand_slug: slug,
    field,
  })
}

export function trackCtaClicked(
  ctaName: string,
  ctaLocation: string,
  destinationUrl: string,
  pageUrl: string,
) {
  capturePostHogEvent('cta_clicked', {
    cta_name: ctaName,
    cta_location: ctaLocation,
    destination_url: destinationUrl,
    page_url: pageUrl,
  })
}

export function trackSubmissionFormErrorShown(field: string, errorType: string, step: string) {
  capturePostHogEvent('submission_form_error_shown', {
    field,
    error_type: errorType,
    step,
  })
}

export function trackApiErrorShown(endpoint: string, statusCode: number, userAction: string) {
  capturePostHogEvent('api_error_shown', {
    endpoint,
    status_code: statusCode,
    user_action: userAction,
  })
}

/** Core Web Vitals field measurement (LCP/CLS/INP/FCP/TTFB).
 *  Shape matches the metric object Next's `useReportWebVitals` yields. */
export function trackWebVital(metric: {
  name: string
  value: number
  rating: string
  delta: number
  id: string
  navigationType?: string
}) {
  // CLS is unitless and small; every other vital is milliseconds. Rounding keeps
  // PostHog property cardinality low without losing meaningful precision.
  const value =
    metric.name === 'CLS'
      ? Math.round(metric.value * 1000) / 1000
      : Math.round(metric.value)

  capturePostHogEvent('web_vital_reported', {
    metric_name: metric.name,
    metric_value: value,
    metric_rating: metric.rating,
    metric_delta: metric.name === 'CLS' ? metric.delta : Math.round(metric.delta),
    metric_id: metric.id,
    navigation_type: metric.navigationType ?? null,
    // Caveat: read at REPORT time. CLS and INP finalize on page-hide, after any
    // soft navigation, so a metric accrued on /brands/<slug> can be tagged with
    // the content group of whatever route the user ended on. Neither the web-vitals
    // metric object nor `useReportWebVitals` exposes the pathname at accrual time,
    // and per-attribution tracking is not worth the machinery for this nuance.
    content_group:
      typeof window !== 'undefined' ? getContentGroup(window.location.pathname) : null,
  })
}

export function trackFeatureRequestSubmitted(requestId: string, category: string) {
  capturePostHogEvent('feature_request_submitted', {
    request_id: requestId,
    category,
  })
}

export function trackFeatureRequestVoted(requestId: string, voted: boolean) {
  capturePostHogEvent('feature_request_voted', {
    request_id: requestId,
    voted,
  })
}
