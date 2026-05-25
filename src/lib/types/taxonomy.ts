export type TagCategory = 'product_type' | 'material' | 'price_range' | 'region' | 'value'

export type TagSource = 'auto' | 'manual' | 'suggested'

export type TaxonomyTag = {
  id: string
  name: string
  nameZh: string | null
  slug: string
  category: TagCategory
  isActive: boolean
  suggestedBy: string | null
  createdAt: string
}

export type BrandTaxonomyJoin = TaxonomyTag & {
  source: TagSource
}
