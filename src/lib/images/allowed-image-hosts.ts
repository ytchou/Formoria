export const ALLOWED_IMAGE_HOSTS = [
  '*.supabase.co',
  '1973home.myshopify.com',
  'cdn01.pinkoi.com',
  'cdn02.pinkoi.com',
  'cms-static.cdn.91app.com',
  'img.gogoshop.cloud',
  'img.shoplineapp.com',
  'shoplineimg.com',
  'twrr.org.tw',
  'www.sobdeall.com.tw',
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

    // next/image remotePatterns are https-only; upgrade http -> https for allowed
    // hosts (these CDNs all serve https) so the returned URL satisfies the optimizer.
    parsedUrl.protocol = 'https:'
    return parsedUrl.toString()
  } catch {
    return null
  }
}
