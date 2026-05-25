import Link from 'next/link'

interface Category {
  slug: string
  name: string
  nameZh: string | null
}

interface CategoryGridProps {
  categories: Category[]
}

export default function CategoryGrid({ categories }: CategoryGridProps) {
  if (categories.length === 0) return null

  return (
    <section>
      <h2 className="mb-6 font-heading text-xl font-bold">探索分類</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {categories.map((category) => (
          <Link
            key={category.slug}
            href={`/brands?category=${category.slug}`}
            className="flex items-center justify-center rounded-xl bg-card px-4 py-6 text-sm font-medium transition-shadow hover:shadow-sm"
          >
            {category.nameZh ?? category.name}
          </Link>
        ))}
      </div>
    </section>
  )
}
