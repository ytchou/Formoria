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

export function buildBadgeEmbedSnippet(siteUrl: string, slug: string): string {
  const href = `${siteUrl}/brands/${slug}?utm_source=badge&utm_medium=referral&utm_campaign=featured_badge&utm_content=${slug}`
  const src = `${siteUrl}/badges/featured-on-formoria.svg`
  return (
    `<a href="${href}">` +
    `<img src="${src}" alt="Featured on Formoria — 台灣製造品牌目錄" width="200" height="56" style="border:0" />` +
    `</a>`
  )
}

export function scaleCardNameFontSize(name: string): number {
  const len = name.length
  if (len <= 8) return 96
  if (len <= 12) return 76
  if (len <= 16) return 64
  if (len <= 20) return 56
  return 40
}
