export const SOURCE_BUCKETS = [
  'direct',
  'search',
  'category',
  'directory',
  'recommendation',
  'external_search',
  'social',
  'external',
] as const

export type SourceBucket = (typeof SOURCE_BUCKETS)[number]

const IN_APP = new Set(['search', 'category', 'directory', 'recommendation'])
const SEARCH_HOSTS = ['google', 'bing', 'yahoo', 'duckduckgo', 'baidu', 'yandex', 'ecosia']
const SOCIAL_HOSTS = [
  'facebook',
  'instagram',
  'threads',
  'twitter',
  'x.com',
  't.co',
  'line',
  'linkedin',
  'youtube',
  'reddit',
  'pinterest',
  'tiktok',
]

export function bucketSource(
  inAppSource: string | undefined,
  referrer: string,
  currentHost: string
): SourceBucket {
  if (inAppSource && IN_APP.has(inAppSource)) {
    return inAppSource as SourceBucket
  }

  let hostname: string

  try {
    hostname = new URL(referrer).hostname
  } catch {
    return 'direct'
  }

  const normalizedHostname = hostname.toLowerCase()
  const normalizedCurrentHost = currentHost.toLowerCase()

  if (
    normalizedHostname === normalizedCurrentHost ||
    normalizedHostname.endsWith(`.${normalizedCurrentHost}`) ||
    normalizedHostname.endsWith(normalizedCurrentHost)
  ) {
    return 'direct'
  }

  if (SEARCH_HOSTS.some((searchHost) => normalizedHostname.includes(searchHost))) {
    return 'external_search'
  }

  if (SOCIAL_HOSTS.some((socialHost) => normalizedHostname.includes(socialHost))) {
    return 'social'
  }

  return 'external'
}

export function normalizeSource(v: unknown): SourceBucket {
  return typeof v === 'string' && (SOURCE_BUCKETS as readonly string[]).includes(v)
    ? (v as SourceBucket)
    : 'direct'
}
