import { getTranslations } from 'next-intl/server'
import type { Locale } from '@/lib/seo/alternates'
import { DirectoryBreadcrumb } from './directory-breadcrumb'
import { CategoryLinkList } from './category-link-list'

type DirectoryLandingFaq = {
  question: string
  answer: string
}

export type DirectoryLandingCopy = {
  title?: string
  description?: string
  h1?: string
  intro?: string
  definition?: string
  faq: DirectoryLandingFaq[]
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

function readFaq(value: unknown): DirectoryLandingFaq[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).flatMap((item) => {
    const question = nonEmptyString(item.question)
    const answer = nonEmptyString(item.answer)
    return question && answer ? [{ question, answer }] : []
  })
}

export function readDirectoryLandingCopy(
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
    faq: readFaq(value.faq),
  }
}

type DirectoryLandingHeadProps = {
  locale: Locale
  category: { slug: string; label: string } | null
  subcategory: { slug: string; label: string } | null
  directoryLabel: string
  breadcrumbAria: string
  pageHeading: string
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

export async function DirectoryLandingHead({
  breadcrumbAria,
  category,
  directoryLabel,
  latestUpdatedAt,
  locale,
  pageHeading,
  subcategory,
  totalCount,
  announceLiveRegion,
}: DirectoryLandingHeadProps) {
  const [categoryT, brandsT] = await Promise.all([
    getTranslations({ locale, namespace: 'categories' }),
    getTranslations({ locale, namespace: 'brands' }),
  ])
  const copy = readDirectoryLandingCopy(
    categoryT,
    category?.slug,
    subcategory?.slug,
  )
  const intro = copy?.intro ?? copy?.description ?? (
    category && categoryT.has(`descriptions.${category.slug}`)
      ? categoryT(`descriptions.${category.slug}`)
      : null
  )
  const updatedDate = formatDate(latestUpdatedAt, locale)
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
        <p className="mt-3 max-w-[42rem] type-body-muted">{intro}</p>
      ) : null}
      <div
        {...(announceLiveRegion
          ? { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }
          : {})}
        className="mt-3 flex flex-wrap gap-x-3 gap-y-1 tabular-nums type-card-description"
      >
        <span>{brandsT('count', { count: totalCount })}</span>
        {updatedDate ? (
          <span>{categoryT('landing.updated', { date: updatedDate })}</span>
        ) : null}
      </div>
      <CategoryLinkList
        locale={locale}
        category={category}
        ariaLabel={categoryT('landing.categoryLinksAria')}
      />
    </header>
  )
}
