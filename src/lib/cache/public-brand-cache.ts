import { revalidatePath } from 'next/cache'

type PublicBrandCacheInput = {
  slug: string
  previousSlug?: string
}

function revalidateBrandSlug(slug: string) {
  revalidatePath(`/brands/${slug}`)
  revalidatePath(`/en/brands/${slug}`)
}

export function revalidatePublicBrand({
  slug,
  previousSlug,
}: PublicBrandCacheInput): void {
  revalidateBrandSlug(slug)
  if (previousSlug && previousSlug !== slug) revalidateBrandSlug(previousSlug)

  revalidatePath('/')
  revalidatePath('/en')
  revalidatePath('/brands')
  revalidatePath('/en/brands')
  revalidatePath('/sitemap.xml')
}

