import { capturePostHogEvent } from './analytics/posthog-provider'

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

export function trackDbClick(brandId: string, destination: string): void {
  try {
    void fetch('/api/analytics/track', {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ brandId, event: 'click', destination }),
    }).catch(() => {})
  } catch {
    // Silently swallow — analytics must never break the app
  }
}

export function trackCategoryFilterApplied(category: string) {
  safeGAEvent('event', 'category_filter_applied', { category })
  capturePostHogEvent('category_filter_applied', { category })
}

export function trackSearchExecuted(query: string, resultCount: number) {
  safeGAEvent('event', 'search', {
    search_term: query,
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
    query,
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

// Stub — share UI doesn't exist yet
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function trackBrandPageShared(_slug: string) {
  // stub
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
  safeGAEvent('event', 'search_no_results', { search_term: searchTerm })
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
