import { getTranslations } from 'next-intl/server'
import type { Locale } from '@/lib/seo/alternates'
import { CategoryLinkList } from './category-link-list'
import { DirectoryBreadcrumb } from './directory-breadcrumb'

export type DirectoryLandingCopy = {
  title?: string
  description?: string
  h1?: string
  intro?: string
  definition?: string
}

type TranslationShape = {
  has: (key: string) => boolean
  raw: (key: string) => unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function readDirectoryLandingCopy(
  translator: TranslationShape,
  categorySlug?: string,
  subcategorySlug?: string,
): DirectoryLandingCopy | null {
  const key = subcategorySlug
    ? `l2.${subcategorySlug}`
    : categorySlug
      ? `l1.${categorySlug}`
      : null
  if (!key || !translator.has(key)) return null

  const value = translator.raw(key)
  if (!isRecord(value)) return null

  return {
    title: nonEmptyString(value.title),
    description: nonEmptyString(value.description),
    h1: nonEmptyString(value.h1),
    intro: nonEmptyString(value.intro),
    definition: nonEmptyString(value.definition),
  }
}

type DirectoryLandingHeadProps = {
  locale: Locale
  category: { slug: string; label: string } | null
  subcategory: { slug: string; label: string } | null
  directoryLabel: string
  breadcrumbAria: string
  pageHeading: string
}

type DirectoryResultStatusProps = {
  locale: Locale
  totalCount: number
  latestUpdatedAt: string | null
  announceLiveRegion: boolean
}

function formatDate(value: string | null, locale: Locale): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(locale === 'zh-TW' ? 'zh-TW' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

/**
 * The count/freshness pair. Lives beside the sort control rather than in the
 * header so the result facts and the control that reorders them read as one
 * row; it stays a server component so the counts are in the server HTML.
 */
export async function DirectoryResultStatus({
  announceLiveRegion,
  latestUpdatedAt,
  locale,
  totalCount,
}: DirectoryResultStatusProps) {
  const [categoryT, brandsT] = await Promise.all([
    getTranslations({ locale, namespace: 'categories' }),
    getTranslations({ locale, namespace: 'brands' }),
  ])
  const updatedDate = formatDate(latestUpdatedAt, locale)

  return (
    <div
      {...(announceLiveRegion
        ? { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }
        : {})}
      className="flex flex-wrap gap-x-3 gap-y-1 tabular-nums type-card-description"
    >
      <span>{brandsT('count', { count: totalCount })}</span>
      {updatedDate ? (
        <span>{categoryT('landing.updated', { date: updatedDate })}</span>
      ) : null}
    </div>
  )
}

export async function DirectoryLandingHead({
  breadcrumbAria,
  category,
  directoryLabel,
  locale,
  pageHeading,
  subcategory,
}: DirectoryLandingHeadProps) {
  const categoryT = await getTranslations({ locale, namespace: 'categories' })
  const copy = readDirectoryLandingCopy(
    categoryT,
    category?.slug,
    subcategory?.slug,
  )
  const summary = copy?.intro ?? copy?.description ?? (
    category && categoryT.has(`descriptions.${category.slug}`)
      ? categoryT(`descriptions.${category.slug}`)
      : null
  )
  const intro = [summary, copy?.definition].filter(Boolean).join(' ')
  const heading = copy?.h1 ?? pageHeading

  return (
    <header className="mb-6">
      <DirectoryBreadcrumb
        ariaLabel={breadcrumbAria}
        locale={locale}
        directoryLabel={directoryLabel}
        category={category}
        subcategory={subcategory}
      />
      <h1 className="text-balance type-page-title">{heading}</h1>
      {intro ? (
        <p className="mt-3 type-body-muted">{intro}</p>
      ) : null}
      <CategoryLinkList
        locale={locale}
        category={category}
        ariaLabel={categoryT('landing.categoryLinksAria')}
      />
    </header>
  )
}
