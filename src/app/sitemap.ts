import type { MetadataRoute } from 'next'
import { getAllBrandSlugs } from '@/lib/services/brands'
import { getActiveCategories } from '@/lib/services/taxonomy'
import { buildAlternates } from '@/lib/seo/alternates'

export const revalidate = 86400 // 24hr ISR

function makeEntry(
  path: string,
  now: Date,
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'],
  priority: number
): MetadataRoute.Sitemap[number] {
  const { languages } = buildAlternates(path, 'zh-TW')
  // Sitemap canonical = zh-TW (prefix-free) URL
  const url = languages['zh-TW']
  return {
    url,
    lastModified: now,
    changeFrequency,
    priority,
    alternates: {
      languages: {
        'zh-TW': languages['zh-TW'],
        en: languages['en'],
      },
    },
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  const staticPages: MetadataRoute.Sitemap = [
    makeEntry('/', now, 'daily', 1.0),
    makeEntry('/brands', now, 'weekly', 0.9),
    makeEntry('/faq', now, 'monthly', 0.5),
    makeEntry('/terms', now, 'monthly', 0.5),
    makeEntry('/support', now, 'monthly', 0.5),
  ]

  try {
    const [brandSlugs, categories] = await Promise.all([
      getAllBrandSlugs(),
      getActiveCategories(),
    ])

    const brandPages: MetadataRoute.Sitemap = brandSlugs.map((slug) =>
      makeEntry(`/brands/${slug}`, now, 'weekly', 0.8)
    )

    const categoryPages: MetadataRoute.Sitemap = categories.map(({ slug }) =>
      makeEntry(`/categories/${slug}`, now, 'weekly', 0.9)
    )

    return [...staticPages, ...brandPages, ...categoryPages]
  } catch {
    // Fallback: static pages only (DB unavailable)
    return staticPages
  }
}
