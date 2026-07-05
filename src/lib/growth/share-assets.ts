interface BuildShareCardUrlOptions {
  download?: boolean
}

export function buildShareCardUrl(
  siteUrl: string,
  slug: string,
  opts?: BuildShareCardUrlOptions,
): string {
  const base = `${siteUrl}/api/share-card/${slug}`
  if (opts?.download) {
    return `${base}?download=1`
  }
  return base
}

export function scaleCardNameFontSize(name: string): number {
  const len = name.length
  if (len <= 8) return 96
  if (len <= 12) return 76
  if (len <= 16) return 64
  if (len <= 20) return 56
  return 40
}
