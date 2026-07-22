import type { Brand } from '@/lib/types'
import type { Locale } from '@/lib/seo/alternates'
import {
  isConfirmedRetailLocation,
  normalizeRetailLocations,
} from '@/lib/brands/locations'
import { FORMORIA_SOCIALS } from './constants'
import { getSiteUrl } from './seo/site-url'

export type BreadcrumbItem = {
  label: string
  href?: string
}

/**
 * schema.org JSON-LD output — values can be any valid JSON type plus nested objects.
 * Record<string, any> is the correct type here: JSON-LD objects are deliberately
 * open-ended schema.org structures, not domain types we control.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonLdObject = Record<string, any>

type JsonLdLocale = Locale | string | undefined

/** Map a next-intl locale to a schema.org inLanguage value. */
function toInLanguage(locale: JsonLdLocale = 'zh-TW'): string {
  return locale === 'zh-TW' ? 'zh-TW' : 'en'
}

/**
 * Build Organization JSON-LD structured data for a brand detail page.
 */
export function buildBrandJsonLd(brand: Brand, locale: Locale = 'zh-TW'): JsonLdObject {
  const brandStoreAddresses = normalizeRetailLocations(brand.retailLocations)
    .filter(
      (location) =>
        isConfirmedRetailLocation(location) &&
        location.relationshipType === 'brand_store',
    )
    .map((location) => location.address)
  const allSameAs = [
    brand.socialInstagram,
    brand.socialThreads,
    brand.socialFacebook,
    brand.purchaseWebsite,
    brand.purchasePinkoi,
    brand.purchaseShopee,
    ...(brand.otherUrls ?? []).map((link) => link.url),
  ].filter((url): url is string => typeof url === 'string' && url.trim().length > 0)

  const jsonLd: JsonLdObject = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: brand.name,
    description: (locale === 'en' ? (brand.descriptionEn ?? brand.description) : brand.description) ?? undefined,
    inLanguage: toInLanguage(locale),
  }

  const url = brand.purchaseWebsite ?? brand.purchasePinkoi ?? brand.purchaseShopee ?? null
  if (url) jsonLd.url = url
  if (brand.heroImageUrl) jsonLd.logo = brand.heroImageUrl
  if (brand.foundingYear) jsonLd.foundingDate = String(brand.foundingYear)
  if (allSameAs.length > 0) jsonLd.sameAs = allSameAs
  if (brandStoreAddresses.length === 1) {
    jsonLd.address = {
      '@type': 'PostalAddress',
      streetAddress: brandStoreAddresses[0],
    }
  } else if (brandStoreAddresses.length > 1) {
    jsonLd.address = brandStoreAddresses.map((address) => ({
      '@type': 'PostalAddress',
      streetAddress: address,
    }))
  }

  return jsonLd
}

/**
 * Build BreadcrumbList JSON-LD structured data.
 */
export function buildBreadcrumbJsonLd(items: BreadcrumbItem[], locale: Locale = 'zh-TW'): JsonLdObject {
  const siteUrl = getSiteUrl()

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    inLanguage: toInLanguage(locale),
    itemListElement: items.map((item, index) => {
      const element: JsonLdObject = {
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
  locale: Locale = 'zh-TW',
  description?: string,
  parentGroup?: string,
): JsonLdObject {
  const siteUrl = getSiteUrl()
  const parentGroupName = parentGroup?.trim()

  const jsonLd: JsonLdObject = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${categoryName} — Taiwanese Brands`,
    url: `${siteUrl}/brands?category=${categorySlug}`,
    inLanguage: toInLanguage(locale),
    numberOfItems: brands.length,
    itemListElement: brands.map((brand, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: brand.name,
      url: `${siteUrl}/brands/${brand.slug}`,
    })),
    ...(parentGroupName ? { about: { '@type': 'Thing', name: parentGroupName } } : {}),
  }

  if (description) jsonLd.description = description

  return jsonLd
}

export function buildBrandsItemListJsonLd(
  brands: Array<{ name: string; slug: string }>,
  locale: Locale = 'zh-TW',
): JsonLdObject {
  const siteUrl = getSiteUrl()
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: locale === 'zh-TW' ? '台灣品牌目錄' : 'Taiwan Brands Directory',
    inLanguage: toInLanguage(locale),
    numberOfItems: brands.length,
    itemListElement: brands.map((b, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: b.name,
      url: `${siteUrl}${locale === 'en' ? '/en' : ''}/brands/${b.slug}`,
    })),
  }
}

/**
 * Build WebSite JSON-LD structured data for the home page.
 */
export function buildWebSiteJsonLd(locale: Locale = 'zh-TW'): JsonLdObject {
  const siteUrl = getSiteUrl()

  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Formoria',
    url: siteUrl,
    inLanguage: toInLanguage(locale),
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
 * Build Formoria Organization JSON-LD structured data.
 */
export function buildOrganizationJsonLd(locale?: string): JsonLdObject {
  const siteUrl = getSiteUrl()
  const inLanguage = toInLanguage(locale)

  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Formoria',
    url: siteUrl,
    logo: `${siteUrl}/images/formoria-mark.png`,
    description:
      inLanguage === 'zh-TW'
        ? 'Formoria 是介紹台灣品牌與在地製造的品牌目錄。'
        : 'Formoria is a directory for discovering Taiwanese brands and makers.',
    inLanguage,
    ...(FORMORIA_SOCIALS.length > 0 ? { sameAs: FORMORIA_SOCIALS } : {}),
  }
}

/**
 * Build Article JSON-LD structured data for editorial pages.
 */
export function buildArticleJsonLd({
  title,
  description,
  path,
  locale,
}: {
  title: string
  description: string
  path: string
  locale?: string
}): JsonLdObject {
  const siteUrl = getSiteUrl()
  const absoluteUrl = `${siteUrl}${path.startsWith('/') ? path : `/${path}`}`

  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    inLanguage: toInLanguage(locale),
    mainEntityOfPage: absoluteUrl,
    publisher: buildOrganizationJsonLd(locale),
    isPartOf: buildWebSiteJsonLd(locale === 'zh-TW' ? 'zh-TW' : 'en'),
  }
}

/**
 * Build DefinedTermSet JSON-LD structured data for glossary pages.
 */
export function buildDefinedTermSetJsonLd(
  terms: Array<{ name: string; description: string }>,
  locale?: string,
): JsonLdObject {
  const inLanguage = toInLanguage(locale)

  return {
    '@context': 'https://schema.org',
    '@type': 'DefinedTermSet',
    name: inLanguage === 'zh-TW' ? 'Formoria 詞彙表' : 'Formoria Glossary',
    inLanguage,
    hasDefinedTerm: terms.map((term) => ({
      '@type': 'DefinedTerm',
      name: term.name,
      description: term.description,
    })),
  }
}


export function safeJsonLdStringify(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
