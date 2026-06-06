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

export function safeImageSrc(url: string | null | undefined): string | null {
  if (!url) {
    return null
  }

  try {
    const parsedUrl = new URL(url)

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return null
    }

    return isAllowedImageHost(parsedUrl.hostname) ? url : null
  } catch {
    return null
  }
}
