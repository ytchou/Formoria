import { createServiceClient } from '@/lib/supabase/server'

type BrandRow = {
  id: string
  slug: string
  name: string
  description: string | null
  hero_image_url: string | null
  product_type: string | null
  purchase_website: string | null
  purchase_pinkoi: string | null
  purchase_shopee: string | null
  social_instagram: string | null
}
type SearchResultRow = {
  brand_id: string
  search_type: string
}
type AiResultRow = {
  brand_id: string
  phase: string
}
type OwnerRow = {
  brand_id: string
}
type Candidate = {
  slug: string
  name: string
  currentHeroUrl: string | null
  descriptionSnippet: string
  criteriaCoverage: string[]
  reasons: string[]
  images: Array<{ url: string; junk: boolean }>
}

const COMMON_WORDS = new Set([
  'apple',
  'basic',
  'black',
  'blue',
  'brown',
  'circle',
  'daily',
  'green',
  'home',
  'light',
  'little',
  'moon',
  'nature',
  'paper',
  'red',
  'river',
  'salt',
  'simple',
  'spring',
  'studio',
  'sun',
  'tea',
  'tree',
  'white',
])

function descriptionSnippet(description: string | null): string {
  const normalized = description?.replace(/\s+/g, ' ').trim() ?? ''
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized
}

function dataRichness(brand: BrandRow): string {
  if (brand.purchase_website) {
    return 'official-site'
  }

  if (brand.purchase_pinkoi || brand.purchase_shopee) {
    return 'marketplace-only'
  }

  if (brand.social_instagram) {
    return 'ig-only'
  }

  return 'sparse-links'
}

function isAmbiguousName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  return normalized.length <= 3 || COMMON_WORDS.has(normalized)
}

function makeCandidate(
  brand: BrandRow,
  searchTypes: Set<string>,
  aiPhases: Set<string>,
  ownerBrandIds: Set<string>
): Candidate {
  const coverage = [
    `product:${brand.product_type ?? 'unknown'}`,
    `data:${dataRichness(brand)}`,
    brand.hero_image_url ? 'hero:present' : 'hero:missing',
    ownerBrandIds.has(brand.id) ? 'owner:claimed' : 'owner:unclaimed',
    isAmbiguousName(brand.name) ? 'name:ambiguous' : 'name:clear',
    searchTypes.size > 0 ? `search:${Array.from(searchTypes).sort().join('+')}` : 'search:none',
    aiPhases.size > 0 ? `ai:${Array.from(aiPhases).sort().join('+')}` : 'ai:none',
  ]

  return {
    slug: brand.slug,
    name: brand.name,
    currentHeroUrl: brand.hero_image_url,
    descriptionSnippet: descriptionSnippet(brand.description),
    criteriaCoverage: coverage,
    reasons: [
      `Covers ${brand.product_type ?? 'unknown'} product type`,
      `Represents ${dataRichness(brand)} data richness`,
      brand.hero_image_url ? 'Has current hero image' : 'Missing current hero image',
      ownerBrandIds.has(brand.id) ? 'Owner-claimed brand' : 'Unclaimed brand',
      isAmbiguousName(brand.name) ? 'Ambiguous or short name' : 'Clear brand name',
    ],
    images: [...new Set([brand.hero_image_url].filter((url): url is string => Boolean(url)))]
      .map((url) => ({ url, junk: false })),
  }
}

function candidateScore(candidate: Candidate): number {
  return candidate.criteriaCoverage.reduce((score, criterion) => {
    if (criterion.includes('unknown') || criterion.includes('none')) {
      return score
    }

    return score + 1
  }, candidate.descriptionSnippet ? 1 : 0)
}

function selectRecommendations(shortlist: Candidate[]): Candidate[] {
  const selected: Candidate[] = []
  const covered = new Set<string>()

  for (const candidate of shortlist) {
    const addsCoverage = candidate.criteriaCoverage.some((criterion) => !covered.has(criterion))

    if (addsCoverage || selected.length < 10) {
      selected.push(candidate)
      candidate.criteriaCoverage.forEach((criterion) => covered.add(criterion))
    }

    if (selected.length >= 10) {
      break
    }
  }

  return selected
}

async function main(): Promise<void> {
  const supabase = createServiceClient()
  const brandsResult = await supabase
    .from('brands')
    .select(
      'id, slug, name, description, hero_image_url, product_type, purchase_website, purchase_pinkoi, purchase_shopee, social_instagram'
    )
    .eq('status', 'approved')
    .order('updated_at', { ascending: false })
    .limit(250)

  if (brandsResult.error) {
    throw new Error(brandsResult.error.message)
  }

  const brands = (brandsResult.data ?? []) as BrandRow[]
  const brandIds = brands.map((brand) => brand.id)

  const [searchResults, aiResults, ownerResults] = await Promise.all([
    supabase.from('brand_search_results').select('brand_id, search_type').in('brand_id', brandIds),
    supabase.from('brand_ai_results').select('brand_id, phase').in('brand_id', brandIds),
    supabase.from('brand_owners').select('brand_id').in('brand_id', brandIds),
  ])

  if (searchResults.error) {
    throw new Error(searchResults.error.message)
  }

  if (aiResults.error) {
    throw new Error(aiResults.error.message)
  }

  if (ownerResults.error) {
    throw new Error(ownerResults.error.message)
  }

  const searchByBrand = new Map<string, Set<string>>()
  for (const row of (searchResults.data ?? []) as SearchResultRow[]) {
    const current = searchByBrand.get(row.brand_id) ?? new Set<string>()
    current.add(row.search_type)
    searchByBrand.set(row.brand_id, current)
  }

  const aiByBrand = new Map<string, Set<string>>()
  for (const row of (aiResults.data ?? []) as AiResultRow[]) {
    const current = aiByBrand.get(row.brand_id) ?? new Set<string>()
    current.add(row.phase)
    aiByBrand.set(row.brand_id, current)
  }

  const ownerBrandIds = new Set(((ownerResults.data ?? []) as OwnerRow[]).map((row) => row.brand_id))
  const shortlist = brands
    .map((brand) =>
      makeCandidate(
        brand,
        searchByBrand.get(brand.id) ?? new Set<string>(),
        aiByBrand.get(brand.id) ?? new Set<string>(),
        ownerBrandIds
      )
    )
    .sort((left, right) => candidateScore(right) - candidateScore(left))
    .slice(0, 20)
  const recommended = selectRecommendations(shortlist)

  console.log(JSON.stringify({
    approved: false,
    shortlist,
    brands: recommended.map((candidate) => ({
      slug: candidate.slug,
      reasons: candidate.reasons,
      labels: {
        heroExpected: candidate.currentHeroUrl ?? undefined,
        images: candidate.images,
        notes: candidate.criteriaCoverage.join('; '),
      },
    })),
  }, null, 2))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main()
}
