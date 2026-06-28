export type TagCategory = 'product_type' | 'value'

export type TaxonomyTag = {
  id: string
  name: string
  nameZh: string | null
  slug: string
  category: TagCategory
  isActive: boolean
  createdAt: string
  brandCount?: number
}
