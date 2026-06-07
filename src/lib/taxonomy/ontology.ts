export const CATEGORY_ONTOLOGY: Record<string, string[]> = {
  fashion: ['clothing', 'footwear', 'bags', 'jewelry', 'accessories'],
  'food-drink': ['food', 'beverages', 'agriculture'],
  beauty: ['beauty', 'bath-body', 'fragrance'],
  home: ['home', 'kitchen', 'furniture', 'gardening'],
  lifestyle: ['stationery', 'art', 'outdoor', 'tech', 'pets', 'baby-kids', 'crafts', 'experiences'],
}

export function parentGroupForSlug(slug: string): string | null {
  for (const [parentGroup, slugs] of Object.entries(CATEGORY_ONTOLOGY)) {
    if (slugs.includes(slug)) {
      return parentGroup
    }
  }

  return null
}
