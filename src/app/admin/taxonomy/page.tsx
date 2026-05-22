import type { Metadata } from 'next'
import { getTags } from '@/lib/services/taxonomy'
import { TagManager } from '@/components/admin/tag-manager'

export const metadata: Metadata = {
  title: '分類管理 | 管理後台 | MIT Map',
}

export default async function TaxonomyPage() {
  const tags = await getTags(undefined, true)

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        Taxonomy
      </h1>
      <p className="mt-2 text-[#7C7570]">
        Manage tags, categories, and taxonomy.
      </p>

      <div className="mt-8">
        <TagManager tags={tags} />
      </div>
    </div>
  )
}
