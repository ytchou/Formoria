import type { Brand } from '@/lib/types'

export type BreadcrumbItem = {
  label: string
  href?: string
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Build Organization JSON-LD structured data for a brand detail page.
 */
export function buildBrandJsonLd(brand: Brand): Record<string, any> {
  const socialUrls = Object.entries(brand.socialLinks)
    .filter(([key]) => key !== 'officialWebsite')
    .map(([, url]) => url)
    .filter(Boolean)

  const jsonLd: Record<string, any> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: brand.name,
    description: brand.description ?? undefined,
  }

  const url = brand.socialLinks.officialWebsite ?? brand.purchaseLinks[0]?.url
  if (url) jsonLd.url = url
  if (brand.logoUrl) jsonLd.logo = brand.logoUrl
  if (brand.heroImageUrl) jsonLd.image = brand.heroImageUrl
  if (brand.foundingYear) jsonLd.foundingDate = String(brand.foundingYear)
  if (brand.contactEmail) jsonLd.email = brand.contactEmail
  if (socialUrls.length > 0) jsonLd.sameAs = socialUrls

  if (brand.retailLocations.length > 0) {
    const loc = brand.retailLocations[0]
    jsonLd.address = {
      '@type': 'PostalAddress',
      streetAddress: loc.address,
    }
  }

  return jsonLd
}

/**
 * Build BreadcrumbList JSON-LD structured data.
 */
export function buildBreadcrumbJsonLd(items: BreadcrumbItem[]): Record<string, any> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => {
      const element: Record<string, any> = {
        '@type': 'ListItem',
        position: index + 1,
        name: item.label,
      }
      if (item.href) {
        element.item = `${siteUrl}${item.href}`
      }
      return element
    }),
  }
}

/**
 * Build ItemList JSON-LD structured data for a category page.
 */
export function buildCategoryItemListJsonLd(
  categoryName: string,
  categorySlug: string,
  brands: Array<{ name: string; slug: string }>,
): Record<string, any> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${categoryName} — Made in Taiwan Brands`,
    url: `${siteUrl}/categories/${categorySlug}`,
    numberOfItems: brands.length,
    itemListElement: brands.map((brand, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: brand.name,
      url: `${siteUrl}/brands/${brand.slug}`,
    })),
  }
}

/**
 * Build WebSite JSON-LD structured data for the home page.
 */
export function buildWebSiteJsonLd(): Record<string, any> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://formoria.com'

  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Formoria',
    alternateName: '島藏',
    url: siteUrl,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${siteUrl}/brands?search={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  }
}

/**
 * Build FAQPage JSON-LD structured data for the FAQ page.
 */
export function buildFaqPageJsonLd(
  items: Array<{ question: string; answer: string }>
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */
