import { getTranslations } from 'next-intl/server'
import type { Locale } from '@/lib/seo/alternates'

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
      className="flex flex-wrap gap-x-3 gap-y-1 tabular-nums type-body-sm"
    >
      <span>{brandsT('count', { count: totalCount })}</span>
      {updatedDate ? (
        <span>{categoryT('landing.updated', { date: updatedDate })}</span>
      ) : null}
    </div>
  )
}
