import type { Metadata } from 'next'
import { getTags } from '@/lib/services/taxonomy'
import { getBrandsForReview } from '@/lib/services/taxonomy'
import { TaxonomyTabs } from '@/components/admin/taxonomy-tabs'

export const metadata: Metadata = {
  title: '分類管理 | 管理後台 | MIT Map',
}

export default async function TaxonomyPage() {
  const [tags, brandsForReview] = await Promise.all([
    getTags(undefined, true),
    getBrandsForReview('auto'),
  ])

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        Taxonomy
      </h1>
      <p className="mt-2 text-[#7C7570]">
        Manage tags, categories, and taxonomy.
      </p>

      <div className="mt-8">
        <TaxonomyTabs tags={tags} brandsForReview={brandsForReview} />
      </div>
    </div>
  )
}
