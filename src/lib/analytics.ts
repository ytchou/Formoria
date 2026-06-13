import { sendGAEvent } from '@next/third-parties/google'

const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const

const UTM_FIRST_TOUCH_KEY = 'formoria_utm_first_touch'
const UTM_LAST_TOUCH_KEY = 'formoria_utm_last_touch'

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
  const pathWithoutLocale = pathname.replace(/^\/(?:zh-TW|en)(?=\/|$)/, '') || '/'

  if (pathWithoutLocale === '/' || pathWithoutLocale === '/brands') {
    return 'directory'
  }

  if (pathWithoutLocale.startsWith('/brands/')) {
    return 'brand_detail'
  }

  if (
    pathWithoutLocale === '/categories' ||
    pathWithoutLocale.startsWith('/categories/')
  ) {
    return 'directory'
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
  const value = localStorage.getItem(key)
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
        localStorage.setItem(UTM_FIRST_TOUCH_KEY, JSON.stringify(utmParams))
      }
      localStorage.setItem(UTM_LAST_TOUCH_KEY, JSON.stringify(utmParams))
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
  source: 'search' | 'category' | 'directory' | 'direct' | 'recommendation' = 'direct'
) {
  safeGAEvent('event', 'view_item', { item_id: slug, source })
}

export function trackBrandCardClicked(
  slug: string,
  category: string | null | undefined,
  positionInGrid: number
) {
  safeGAEvent('event', 'select_item', {
    item_id: slug,
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

export function mapPurchaseDestination(platform: string): string {
  return platform
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 32)
}

export function trackCategoryFilterApplied(category: string) {
  safeGAEvent('event', 'category_filter_applied', { category })
}

export function trackSearchExecuted(query: string, resultCount: number) {
  safeGAEvent('event', 'search', {
    search_term: query,
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
    ...getUtmParams(window.location.search),
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

export function trackOnboardingBannerShown(slug: string) {
  safeGAEvent('event', 'onboarding_banner_shown', { brand_slug: slug })
}

export function trackOnboardingBannerCtaClick(slug: string) {
  safeGAEvent('event', 'onboarding_banner_cta_click', { brand_slug: slug })
}

export function trackOnboardingBannerDismiss(slug: string) {
  safeGAEvent('event', 'onboarding_banner_dismiss', { brand_slug: slug })
}

export function trackOnboardingMilestoneReached(
  slug: string,
  milestone: 'getting_started' | 'halfway' | 'complete'
) {
  safeGAEvent('event', 'onboarding_milestone_reached', {
    brand_slug: slug,
    milestone,
  })
}

export function trackSignUp(method: string) {
  safeGAEvent('event', 'sign_up', {
    method,
    ...getUtmParams(window.location.search),
  })
}

export function trackLogin(method: string) {
  safeGAEvent('event', 'login', { method })
}

export function trackViewItemList(listName: string, itemCount: number) {
  safeGAEvent('event', 'view_item_list', {
    item_list_name: listName,
    item_count: itemCount,
  })
}
