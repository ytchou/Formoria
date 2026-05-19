import type { MetadataRoute } from 'next'
import { getAllBrandSlugs } from '@/lib/services/brands'
import { getActiveCategories } from '@/lib/services/taxonomy'

export const revalidate = 86400 // 24hr ISR

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const now = new Date()

  try {
    const [brandSlugs, categories] = await Promise.all([
      getAllBrandSlugs(),
      getActiveCategories(),
    ])

    const staticPages: MetadataRoute.Sitemap = [
      {
        url: siteUrl,
        lastModified: now,
        changeFrequency: 'daily',
        priority: 1.0,
      },
    ]

    const brandPages: MetadataRoute.Sitemap = brandSlugs.map((slug) => ({
      url: `${siteUrl}/${slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }))

    const categoryPages: MetadataRoute.Sitemap = categories.map(({ slug }) => ({
      url: `${siteUrl}/categories/${slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.9,
    }))

    return [...staticPages, ...brandPages, ...categoryPages]
  } catch {
    // Fallback: minimal sitemap on error
    return [
      {
        url: siteUrl,
        lastModified: now,
        changeFrequency: 'daily',
        priority: 1.0,
      },
    ]
  }
}
