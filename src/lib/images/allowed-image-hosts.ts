export const ALLOWED_IMAGE_HOSTS = [
  '*.supabase.co',
] as const satisfies string[]

export const NON_IMAGE_HOSTS = [
  'facebook.com',
  'line.me',
  'instagram.com',
  'cdninstagram.com',
] as const

export function isAllowedImageHost(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase()

  return ALLOWED_IMAGE_HOSTS.some((pattern) => {
    const normalizedPattern = pattern.toLowerCase()

    if (normalizedPattern.startsWith('**.')) {
      const suffix = normalizedPattern.slice(3)
      return normalizedHostname.endsWith(`.${suffix}`)
    }

    if (normalizedPattern.startsWith('*.')) {
      const suffix = normalizedPattern.slice(2)
      return normalizedHostname.endsWith(`.${suffix}`)
    }

    return normalizedHostname === normalizedPattern
  })
}

export function isNonImageHost(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    const normalizedHostname = parsedUrl.hostname.toLowerCase()

    return NON_IMAGE_HOSTS.some(
      (host) =>
        normalizedHostname === host ||
        normalizedHostname.endsWith(`.${host}`),
    )
  } catch {
    return false
  }
}

export function safeImageSrc(url: string | null | undefined): string | null {
  if (!url) {
    return null
  }

  try {
    const parsedUrl = new URL(url)

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return null
    }

    if (!isAllowedImageHost(parsedUrl.hostname)) {
      return null
    }

    parsedUrl.protocol = 'https:'
    return parsedUrl.toString()
  } catch {
    return null
  }
}
