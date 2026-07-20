import { getContentGroup } from '@/lib/analytics'

const UTM_KEYS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
])

const SENSITIVE_PROPERTY_KEYS = new Set([
  'access_token',
  'auth_code',
  'authorization',
  'brand_name',
  'code',
  'email',
  'email_address',
  'form_values',
  'form_data',
  'full_name',
  'first_name',
  'last_name',
  'name',
  'password',
  'phone',
  'phone_number',
  'query',
  'refresh_token',
  'search_term',
  'token',
  'user_email',
  'user_name',
])

const URL_PROPERTY_KEYS = new Set([
  '$current_url',
  '$initial_current_url',
  '$initial_referrer',
  '$referrer',
])

const BLOCKED_PATH_SEGMENTS = ['/admin', '/auth', '/challenge', '/api', '/_next']

type PostHogEvent = {
  event: string
  properties?: Record<string, unknown>
  [key: string]: unknown
}

function stripLocale(pathname: string): string {
  return pathname.replace(/^\/(?:zh-TW|en)(?=\/|$)/, '') || '/'
}

function pathnameFrom(value: string): string {
  try {
    return new URL(value, 'https://formoria.com').pathname
  } catch {
    return value.split(/[?#]/, 1)[0] ?? '/'
  }
}

export function isPostHogAnalyticsPath(value: string): boolean {
  const pathname = stripLocale(pathnameFrom(value))
  return !BLOCKED_PATH_SEGMENTS.some(
    (segment) => pathname === segment || pathname.startsWith(`${segment}/`),
  )
}

export function sanitizePostHogUrl(value: string): string {
  try {
    const url = new URL(value, 'https://formoria.com')
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'https://formoria.com/'
    }
    if (url.hostname !== 'formoria.com' && !url.hostname.endsWith('.formoria.com')) {
      return `${url.origin}/`
    }
    const safeParams = new URLSearchParams()
    for (const [key, parameterValue] of url.searchParams) {
      if (UTM_KEYS.has(key)) safeParams.append(key, parameterValue)
    }
    url.search = safeParams.toString()
    url.hash = ''
    return url.toString()
  } catch {
    return pathnameFrom(value)
  }
}

function scrubValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubValue)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, nestedValue]) =>
      SENSITIVE_PROPERTY_KEYS.has(key.toLowerCase())
        ? []
        : [[key, scrubValue(nestedValue)]],
    ),
  )
}

function analyticsLocale(pathname: string): 'en' | 'zh-TW' {
  return pathname === '/en' || pathname.startsWith('/en/') ? 'en' : 'zh-TW'
}

export function sanitizePostHogEvent<T extends PostHogEvent>(event: T): T | null {
  const properties = { ...(event.properties ?? {}) }
  const currentUrl = typeof properties.$current_url === 'string'
    ? properties.$current_url
    : typeof window !== 'undefined'
      ? window.location.href
      : 'https://formoria.com/'
  const pathname = pathnameFrom(currentUrl)

  if (!isPostHogAnalyticsPath(pathname)) return null

  for (const key of URL_PROPERTY_KEYS) {
    if (typeof properties[key] === 'string') {
      properties[key] = sanitizePostHogUrl(properties[key])
    }
  }

  const scrubbed = scrubValue(properties) as Record<string, unknown>
  scrubbed.analytics_schema_version = 1
  scrubbed.environment = 'production'
  scrubbed.locale = analyticsLocale(pathname)
  scrubbed.content_group = getContentGroup(pathname)
  scrubbed.surface = stripLocale(pathname).startsWith('/dashboard') ? 'product' : 'public'

  return { ...event, properties: scrubbed }
}
