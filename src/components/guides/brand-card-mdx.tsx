import Image from 'next/image'
import Link from 'next/link'

import { NotFoundError } from '@/lib/errors'
import { getBrandBySlug } from '@/lib/services/brands'

type BrandCardMdxProps = {
  slug: string
}

export async function BrandCardMdx({ slug }: BrandCardMdxProps) {
  let brand

  try {
    brand = await getBrandBySlug(slug)
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error

    return (
      <div className="rounded-xl border border-dashed border-stone-300 bg-stone-100 p-4 text-sm text-stone-600">
        {slug}
      </div>
    )
  }

  const imageUrl = brand.heroImageUrl

  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-stone-100">
      <Link href={`/brands/${brand.slug}`} className="block p-4">
        <div className="flex items-start gap-4">
          {imageUrl ? (
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-white">
              <Image src={imageUrl} alt={brand.name} fill className="object-cover" />
            </div>
          ) : null}
          <div className="min-w-0">
            <div className="font-semibold text-stone-900">{brand.name}</div>
            <div className="mt-1 text-sm text-stone-600">{brand.category ?? 'Brand'}</div>
          </div>
        </div>
      </Link>
    </div>
  )
}
