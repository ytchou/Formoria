import { capturePostHogEvent, resetPostHogUser } from './analytics/posthog-provider'
import { ANALYTICS_EVENTS } from './analytics/events'

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
    capturePostHogEvent(ANALYTICS_EVENTS.BRAND_DETAIL_VIEWED, {
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
    capturePostHogEvent(ANALYTICS_EVENTS.BRAND_CARD_CLICKED, {
      brand_id: brandId,
      brand_slug: slug,
      category: category ?? null,
      position_in_grid: positionInGrid,
    })
  }
}

export type ExternalLinkSurface = 'detail_page' | 'card' | 'recommendation'

export function trackExternalLinkClicked(
  slug: string,
  linkType: string,
  referrerPage: string,
  surface: ExternalLinkSurface,
  brandId?: string,
) {
  // NOT `surface`: posthog-privacy.ts's before_send unconditionally overwrites a
  // top-level `surface` property with 'public' | 'product' on every event, and
  // posthog-queries.ts filters owner analytics on surface = 'public'. Reusing the
  // name would silently drop this value and corrupt that filter.
  safeGAEvent('event', 'external_link_clicked', {
    brand_slug: slug,
    link_type: linkType,
    referrer_page: referrerPage,
    link_surface: surface,
  })
  if (brandId) {
    capturePostHogEvent(ANALYTICS_EVENTS.EXTERNAL_LINK_CLICKED, {
      brand_id: brandId,
      brand_slug: slug,
      link_type: linkType,
      link_surface: surface,
    })
  }
}

export function trackCategoryFilterApplied(category: string) {
  safeGAEvent('event', 'category_filter_applied', { category })
  capturePostHogEvent(ANALYTICS_EVENTS.CATEGORY_FILTER_APPLIED, { category })
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
  capturePostHogEvent(ANALYTICS_EVENTS.BRAND_SEARCH_EXECUTED, {
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
    capturePostHogEvent(ANALYTICS_EVENTS.SEARCH_RESULT_CLICKED, {
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
  capturePostHogEvent(ANALYTICS_EVENTS.SUBMISSION_FORM_OPENED, {
    source,
    intent: intent === 'owner' ? 'owner_claim' : intent,
  })
}

export function trackSubmissionFormStepCompleted(step: string) {
  safeGAEvent('event', 'submission_form_step_completed', { step })
  capturePostHogEvent(ANALYTICS_EVENTS.SUBMISSION_FORM_STEP_COMPLETED, { step })
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
  capturePostHogEvent(ANALYTICS_EVENTS.SUBMISSION_COMPLETED, {
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
  capturePostHogEvent(ANALYTICS_EVENTS.SUBMISSION_FORM_ABANDONED, {
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
  capturePostHogEvent(ANALYTICS_EVENTS.BRAND_PAGE_SHARED, {
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
    capturePostHogEvent(ANALYTICS_EVENTS.GALLERY_PHOTO_VIEWED, {
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
    capturePostHogEvent(ANALYTICS_EVENTS.SEARCH_SUGGESTION_SELECTED, {
      brand_id: brandId,
      brand_slug: slug,
    })
  }
}

export function trackSearchNoResults(searchTerm: string) {
  safeGAEvent('event', 'search_no_results', { query_length: searchTerm.length })
  capturePostHogEvent(ANALYTICS_EVENTS.BRAND_SEARCH_EMPTY, { query_length: searchTerm.length })
}

export function trackSignUp(method: string) {
  const utmParams =
    typeof window !== 'undefined' ? getUtmParams(window.location.search) : {}

  safeGAEvent('event', 'sign_up', {
    method,
    ...utmParams,
  })
  capturePostHogEvent(ANALYTICS_EVENTS.USER_SIGNED_UP, { method, ...utmParams })
}

export function trackLogin(method: string) {
  safeGAEvent('event', 'login', { method })
  capturePostHogEvent(ANALYTICS_EVENTS.USER_LOGGED_IN, { method })
}

// Routed through the provider shim rather than `posthog-js` directly: the sign-out
// control lives in the globally hydrated nav, and a static SDK import there would
// pull the whole bundle into the shared chunk.
export function trackSignOut() {
  // Emitted through the reset itself: a separate capture beforehand is wiped by the
  // buffer clear when no provider has registered yet.
  resetPostHogUser({ event: ANALYTICS_EVENTS.USER_SIGNED_OUT })
}

export function trackViewItemList(listName: string, itemCount: number) {
  safeGAEvent('event', 'view_item_list', {
    item_list_name: listName,
    item_count: itemCount,
  })
  capturePostHogEvent(ANALYTICS_EVENTS.BRAND_LIST_VIEWED, {
    list_name: listName,
    item_count: itemCount,
  })
}

export function trackHeroCategoryClicked(category: string, destinationUrl: string) {
  capturePostHogEvent(ANALYTICS_EVENTS.HERO_CATEGORY_CLICKED, { category, destination_url: destinationUrl })
}

export function trackDirectorySortChanged(sortValue: string, previousSort: string) {
  capturePostHogEvent(ANALYTICS_EVENTS.DIRECTORY_SORT_CHANGED, {
    sort_value: sortValue,
    previous_sort: previousSort,
  })
}

export function trackDirectoryPageNavigated(
  pageNumber: number,
  direction: string,
  totalPages: number,
) {
  capturePostHogEvent(ANALYTICS_EVENTS.DIRECTORY_PAGE_NAVIGATED, {
    page_number: pageNumber,
    direction,
    total_pages: totalPages,
  })
}

// `result_count` is the facet count already rendered next to the subcategory chip —
// it is the post-filter brand count and is known at click time, before the filtered
// page loads. Always an integer; never null.
export function trackSubcategoryFilterApplied(
  subcategory: string,
  parentCategory: string,
  resultCount: number,
) {
  capturePostHogEvent(ANALYTICS_EVENTS.SUBCATEGORY_FILTER_APPLIED, {
    subcategory,
    parent_category: parentCategory,
    result_count: Math.trunc(resultCount),
  })
}

export function trackPriceFilterApplied(priceRange: string) {
  capturePostHogEvent(ANALYTICS_EVENTS.PRICE_FILTER_APPLIED, { price_range: priceRange })
}

export function trackVerificationFilterApplied(status: string) {
  capturePostHogEvent(ANALYTICS_EVENTS.VERIFICATION_FILTER_APPLIED, { status })
}

export function trackFilterCleared(clearType: string, filterType?: string, filterValue?: string) {
  capturePostHogEvent(ANALYTICS_EVENTS.FILTER_CLEARED, {
    clear_type: clearType,
    filter_type: filterType,
    filter_value: filterValue,
  })
}

export function trackLanguageSwitched(fromLocale: string, toLocale: string, location: string) {
  capturePostHogEvent(ANALYTICS_EVENTS.LANGUAGE_SWITCHED, {
    from_locale: fromLocale,
    to_locale: toLocale,
    location,
  })
}

export function trackBrandSaved(brandId: string, slug: string, location: string) {
  capturePostHogEvent(ANALYTICS_EVENTS.BRAND_SAVED, {
    brand_id: brandId,
    brand_slug: slug,
    location,
  })
}

/** First qualifying signal that a visitor actually engaged with a brand page. */
export type EngagementTrigger = 'dwell' | 'gallery' | 'faq' | 'channel' | 'scroll_50'

// PostHog-only, like trackBrandSaved: engagement depth is a product metric, not a
// GA conversion signal, and GA4 event quota is better spent elsewhere.
export function trackBrandDetailEngaged(
  slug: string,
  trigger: EngagementTrigger,
  brandId?: string,
) {
  capturePostHogEvent(ANALYTICS_EVENTS.BRAND_DETAIL_ENGAGED, {
    brand_slug: slug,
    trigger,
    ...(brandId ? { brand_id: brandId } : {}),
  })
}

export type SavedBrandRevisitSurface = 'card' | 'detail_page'

export function trackSavedBrandRevisited(
  slug: string,
  surface: SavedBrandRevisitSurface,
  brandId?: string,
) {
  // `revisit_surface`, not `surface` — see trackExternalLinkClicked above: a
  // top-level `surface` is overwritten by the before_send scrubber.
  capturePostHogEvent(ANALYTICS_EVENTS.SAVED_BRAND_REVISITED, {
    brand_slug: slug,
    revisit_surface: surface,
    ...(brandId ? { brand_id: brandId } : {}),
  })
}

export function trackBrandUnsaved(brandId: string, slug: string, location: string) {
  capturePostHogEvent(ANALYTICS_EVENTS.BRAND_UNSAVED, {
    brand_id: brandId,
    brand_slug: slug,
    location,
  })
}

export function trackBrandLiked(brandId: string, slug: string) {
  capturePostHogEvent(ANALYTICS_EVENTS.BRAND_LIKED, {
    brand_id: brandId,
    brand_slug: slug,
    location: 'brand_detail',
  })
}

export function trackBrandUnliked(brandId: string, slug: string) {
  capturePostHogEvent(ANALYTICS_EVENTS.BRAND_UNLIKED, {
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
  capturePostHogEvent(ANALYTICS_EVENTS.RECOMMENDATION_BRAND_CLICKED, {
    brand_id: brandId,
    brand_slug: slug,
    source_brand_slug: sourceBrandSlug,
    position,
  })
}

export function trackRecommendationSectionViewed(sourceBrandSlug: string, count: number) {
  capturePostHogEvent(ANALYTICS_EVENTS.RECOMMENDATION_SECTION_VIEWED, {
    source_brand_slug: sourceBrandSlug,
    recommendation_count: count,
  })
}

export function trackGalleryCompleted(brandId: string, slug: string, imageCount: number) {
  capturePostHogEvent(ANALYTICS_EVENTS.GALLERY_COMPLETED, {
    brand_id: brandId,
    brand_slug: slug,
    image_count: imageCount,
  })
}

export function trackFaqItemExpanded(brandSlug: string, index: number) {
  capturePostHogEvent(ANALYTICS_EVENTS.FAQ_ITEM_EXPANDED, {
    brand_slug: brandSlug,
    item_index: index,
  })
}

export function trackSubmissionPathSelected(path: string, isAuthenticated: boolean) {
  const utmParams =
    typeof window !== 'undefined' ? getUtmParams(window.location.search) : {}

  capturePostHogEvent(ANALYTICS_EVENTS.SUBMISSION_PATH_SELECTED, {
    path,
    is_authenticated: isAuthenticated,
    ...utmParams,
  })
}

export function trackNewsletterSubscribed(interests: string[], hasEmail: boolean) {
  const utmParams =
    typeof window !== 'undefined' ? getUtmParams(window.location.search) : {}

  capturePostHogEvent(ANALYTICS_EVENTS.NEWSLETTER_SUBSCRIBED, {
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
  capturePostHogEvent(ANALYTICS_EVENTS.BRAND_CLAIM_STARTED, {
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
  capturePostHogEvent(ANALYTICS_EVENTS.MIT_DECLARED, {
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
  capturePostHogEvent(ANALYTICS_EVENTS.ORIGIN_EVIDENCE_SUBMITTED, {
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
  capturePostHogEvent(ANALYTICS_EVENTS.BRAND_CLAIM_FORM_SUBMITTED, {
    brand_id: brandId,
    brand_slug: brandSlug,
    proof_types: proofTypes,
  })
}

export function trackBrandReported(slug: string, reason: string, reporterRole: string) {
  capturePostHogEvent(ANALYTICS_EVENTS.BRAND_REPORTED, {
    brand_slug: slug,
    reason,
    reporter_role: reporterRole,
  })
}

export function trackCorrectionSubmitted(brandId: string, slug: string, field: string) {
  capturePostHogEvent(ANALYTICS_EVENTS.BRAND_CORRECTION_SUBMITTED, {
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
  capturePostHogEvent(ANALYTICS_EVENTS.CTA_CLICKED, {
    cta_name: ctaName,
    cta_location: ctaLocation,
    destination_url: destinationUrl,
    page_url: pageUrl,
  })
}

export function trackSubmissionFormErrorShown(field: string, errorType: string, step: string) {
  capturePostHogEvent(ANALYTICS_EVENTS.SUBMISSION_FORM_ERROR_SHOWN, {
    field,
    error_type: errorType,
    step,
  })
}

export function trackApiErrorShown(endpoint: string, statusCode: number, userAction: string) {
  capturePostHogEvent(ANALYTICS_EVENTS.API_ERROR_SHOWN, {
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

  capturePostHogEvent(ANALYTICS_EVENTS.WEB_VITAL_REPORTED, {
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

export function trackFeatureRequestSubmitted(requestId: string) {
  capturePostHogEvent(ANALYTICS_EVENTS.FEATURE_REQUEST_SUBMITTED, {
    request_id: requestId,
  })
}

export function trackFeatureRequestVoted(requestId: string, voted: boolean) {
  capturePostHogEvent(ANALYTICS_EVENTS.FEATURE_REQUEST_VOTED, {
    request_id: requestId,
    voted,
  })
}
