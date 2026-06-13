import type { Metadata } from 'next'
import { TagManager } from '@/components/admin/tag-manager'
import { getTags, getUntaggedBrands } from '@/lib/services/taxonomy'

export const metadata: Metadata = {
  title: '分類管理 | 管理後台',
}

export default async function TaxonomyPage() {
  const [tags, untaggedBrands] = await Promise.all([
    getTags(undefined, true),
    getUntaggedBrands(),
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
        <TagManager tags={tags} />
      </div>

      <section className="mt-10">
        <h2 className="font-heading text-xl font-semibold tracking-tight">
          Untagged Brands
        </h2>
        {untaggedBrands.length === 0 ? (
          <p className="mt-3 text-sm text-[#7C7570]">
            All approved brands have taxonomy tags.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[#E5E4E1] rounded-lg border border-[#E5E4E1]">
            {untaggedBrands.map((brand) => (
              <li key={brand.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-[#1A1918]">{brand.name}</p>
                  {brand.category && (
                    <p className="mt-0.5 text-xs text-[#7C7570]">{brand.category}</p>
                  )}
                </div>
                <span className="text-xs text-[#7C7570]">{brand.slug}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
