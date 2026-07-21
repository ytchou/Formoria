import { getContentGroup } from '@/lib/analytics'

const UTM_KEYS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
])
const POSTHOG_UTM_KEYS = new Set(Array.from(UTM_KEYS).flatMap((key) => [key, `$${key}`]))
const SAFE_CAMPAIGN_VALUE = /^[\p{L}\p{N}][\p{L}\p{N}._~-]{0,99}$/u

const SENSITIVE_PROPERTY_KEYS = new Set([
  '$el_text',
  'access_token',
  'action',
  'attr__action',
  'attr__href',
  'attr__value',
  'attributes',
  'auth_code',
  'authorization',
  'brand_name',
  'code',
  'email',
  'email_address',
  'element_text',
  'form_values',
  'form_data',
  'full_name',
  'href',
  'first_name',
  'last_name',
  'name',
  'password',
  'phone',
  'phone_number',
  'query',
  'refresh_token',
  'search_term',
  'text',
  'token',
  'user_email',
  'user_name',
  'value',
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

function sanitizeCampaignValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return SAFE_CAMPAIGN_VALUE.test(trimmed) ? trimmed : null
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
      const safeValue = UTM_KEYS.has(key) ? sanitizeCampaignValue(parameterValue) : null
      if (safeValue) safeParams.append(key, safeValue)
    }
    url.search = safeParams.toString()
    url.hash = ''
    return url.toString()
  } catch {
    return 'https://formoria.com/'
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

  for (const key of POSTHOG_UTM_KEYS) {
    if (!(key in properties)) continue
    const safeValue = sanitizeCampaignValue(properties[key])
    if (safeValue) properties[key] = safeValue
    else delete properties[key]
  }

  const scrubbed = scrubValue(properties) as Record<string, unknown>
  scrubbed.analytics_schema_version = 1
  scrubbed.environment = 'production'
  scrubbed.locale = analyticsLocale(pathname)
  scrubbed.content_group = getContentGroup(pathname)
  scrubbed.surface = stripLocale(pathname).startsWith('/dashboard') ? 'product' : 'public'

  return { ...event, properties: scrubbed }
}
