import { cleanBrandName, detectNonBrand, matchCategory, normalizeSlug } from './brand-cleanup'

export interface CurationConfig {
  dryRun: boolean
  slugs?: string[]
  limit?: number
  onProgress?: (msg: string) => void
}

export interface OperationResult {
  processed: number
  updated: number
  skipped: number
  errors: string[]
}

type CurationBrand = {
  id: string
  slug: string
  display_brand_name: string
  status?: string | null
  description?: string | null
  product_type?: string | null
  website_url?: string | null
  is_visible?: boolean | null
  purchase_website?: string | null
  purchaseWebsite?: string | null
}

type CleanupPatch = Partial<Pick<CurationBrand, 'display_brand_name' | 'slug'>>
type AutoTagPatch = Partial<Pick<CurationBrand, 'product_type'>>
type SetVisibilityPatch = Partial<Pick<CurationBrand, 'is_visible'>>
type CurationPatch = CleanupPatch & AutoTagPatch & SetVisibilityPatch

type CleanNamesPhase = {
  changed: boolean
  patch: Pick<CleanupPatch, 'display_brand_name'>
}

type NormalizeSlugsPhase = {
  changed: boolean
  patch: Pick<CleanupPatch, 'slug'>
}

type DetectNonBrandsPhase = {
  isNonBrand: boolean
  reason: string | null
  confidence: 'high' | 'medium' | 'low'
}

type CleanupPhases = {
  cleanNames: CleanNamesPhase
  normalizeSlugs: NormalizeSlugsPhase
  detectNonBrands: DetectNonBrandsPhase
}

type ProcessCleanupOptions = {
  scrapedName?: string | null
}

type ProcessCleanupResult = {
  phases: CleanupPhases
  hasChanges: boolean
  patch: CleanupPatch
}

type AutoTagBrand = Pick<CurationBrand, 'id'> &
  Partial<Pick<CurationBrand, 'display_brand_name' | 'description' | 'product_type'>>

type ProcessAutoTagResult = {
  changed: boolean
  category: string | null
  patch?: Pick<AutoTagPatch, 'product_type'>
}

type SetVisibilityBrand = Pick<CurationBrand, 'id'> &
  Partial<
    Pick<
      CurationBrand,
      'status' | 'display_brand_name' | 'website_url' | 'description' | 'is_visible'
    >
  >

type ProcessSetVisibilityResult = {
  visible: boolean
  changed: boolean
  patch?: Pick<SetVisibilityPatch, 'is_visible'>
}

type SupabaseError = {
  message?: string
}

type SupabaseResult<T> = Promise<{
  data: T | null
  error: SupabaseError | null
}>

type BrandsSelectQuery = PromiseLike<{
  data: CurationBrand[] | null
  error: SupabaseError | null
}> & {
  in: (column: 'slug', values: string[]) => BrandsSelectQuery
  limit: (count: number) => BrandsSelectQuery
}

type BrandsUpdateQuery = {
  eq: (column: 'id', value: string) => SupabaseResult<unknown>
}

type BrandsTable = {
  select: (columns: string) => BrandsSelectQuery
  update: (patch: CurationPatch) => BrandsUpdateQuery
}

type SupabaseLike = {
  from: (table: 'brands') => BrandsTable
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

export function processCleanupBrand(
  brand: CurationBrand,
  opts: ProcessCleanupOptions = {}
): ProcessCleanupResult {
  const patch: CleanupPatch = {}
  const nameCleanup = cleanBrandName(brand.display_brand_name)
  const slugCleanup = normalizeSlug(brand.slug, opts.scrapedName ?? null)
  const nonBrandDetection = detectNonBrand({
    name: brand.display_brand_name,
    description: brand.description,
    purchaseWebsite: brand.purchaseWebsite ?? brand.purchase_website,
  })

  const cleanNames: CleanNamesPhase = {
    changed: nameCleanup.changed,
    patch: {},
  }

  if (nameCleanup.changed) {
    cleanNames.patch.display_brand_name = nameCleanup.cleanedName
    patch.display_brand_name = nameCleanup.cleanedName
  }

  const normalizeSlugs: NormalizeSlugsPhase = {
    changed: slugCleanup.newSlug !== null && slugCleanup.newSlug !== brand.slug,
    patch: {},
  }

  if (normalizeSlugs.changed && slugCleanup.newSlug) {
    normalizeSlugs.patch.slug = slugCleanup.newSlug
    patch.slug = slugCleanup.newSlug
  }

  return {
    phases: {
      cleanNames,
      normalizeSlugs,
      detectNonBrands: nonBrandDetection,
    },
    hasChanges: Object.keys(patch).length > 0,
    patch,
  }
}

export function processAutoTagBrand(brand: AutoTagBrand): ProcessAutoTagResult {
  if (brand.product_type) {
    return {
      changed: false,
      category: brand.product_type,
    }
  }

  const text = `${brand.display_brand_name ?? ''} ${brand.description ?? ''}`
  const category = matchCategory(text)

  if (!category) {
    return {
      changed: false,
      category: null,
    }
  }

  return {
    changed: true,
    category,
    patch: { product_type: category },
  }
}

export function processSetVisibilityBrand(
  brand: SetVisibilityBrand
): ProcessSetVisibilityResult {
  const visible =
    brand.status === 'approved' &&
    Boolean(brand.website_url?.trim()) &&
    Boolean(brand.description && brand.description.length >= 20) &&
    Boolean(brand.display_brand_name?.trim())

  if (brand.is_visible === visible) {
    return {
      visible,
      changed: false,
    }
  }

  return {
    visible,
    changed: true,
    patch: { is_visible: visible },
  }
}

export async function runCleanup(
  config: CurationConfig,
  supabase: SupabaseLike
): Promise<OperationResult> {
  const result: OperationResult = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  }

  let query = supabase
    .from('brands')
    .select('id, slug, display_brand_name, status, description, purchase_website')

  if (config.slugs && config.slugs.length > 0) {
    query = query.in('slug', config.slugs)
  }

  if (config.limit !== undefined) {
    query = query.limit(config.limit)
  }

  const { data, error } = await query

  if (error) {
    result.errors.push(error.message ?? 'Failed to fetch brands')
    return result
  }

  for (const brand of data ?? []) {
    result.processed += 1
    config.onProgress?.(`Processing ${brand.slug}`)

    try {
      const cleanup = processCleanupBrand(brand)

      if (!cleanup.hasChanges) {
        result.skipped += 1
        continue
      }

      if (!config.dryRun) {
        const { error: updateError } = await supabase
          .from('brands')
          .update(cleanup.patch)
          .eq('id', brand.id)

        if (updateError) {
          result.errors.push(`${brand.slug}: ${updateError.message ?? 'Failed to update brand'}`)
          result.skipped += 1
          continue
        }
      }

      result.updated += 1
    } catch (err) {
      result.errors.push(`${brand.slug}: ${errorMessage(err)}`)
      result.skipped += 1
    }
  }

  return result
}

export async function runAutoTag(
  config: CurationConfig,
  supabase: SupabaseLike
): Promise<OperationResult> {
  const result: OperationResult = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  }

  let query = supabase
    .from('brands')
    .select('id, slug, display_brand_name, description, product_type')

  if (config.slugs && config.slugs.length > 0) {
    query = query.in('slug', config.slugs)
  }

  if (config.limit !== undefined) {
    query = query.limit(config.limit)
  }

  const { data, error } = await query

  if (error) {
    result.errors.push(error.message ?? 'Failed to fetch brands')
    return result
  }

  for (const brand of data ?? []) {
    result.processed += 1
    config.onProgress?.(`Processing ${brand.slug}`)

    try {
      const autoTag = processAutoTagBrand(brand)

      if (!autoTag.changed || !autoTag.patch) {
        result.skipped += 1
        continue
      }

      if (!config.dryRun) {
        const { error: updateError } = await supabase
          .from('brands')
          .update(autoTag.patch)
          .eq('id', brand.id)

        if (updateError) {
          result.errors.push(`${brand.slug}: ${updateError.message ?? 'Failed to update brand'}`)
          result.skipped += 1
          continue
        }
      }

      result.updated += 1
    } catch (err) {
      result.errors.push(`${brand.slug}: ${errorMessage(err)}`)
      result.skipped += 1
    }
  }

  return result
}

export async function runSetVisibility(
  config: CurationConfig,
  supabase: SupabaseLike
): Promise<OperationResult> {
  const result: OperationResult = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  }

  let query = supabase
    .from('brands')
    .select('id, slug, status, display_brand_name, website_url, description, is_visible')

  if (config.slugs && config.slugs.length > 0) {
    query = query.in('slug', config.slugs)
  }

  if (config.limit !== undefined) {
    query = query.limit(config.limit)
  }

  const { data, error } = await query

  if (error) {
    result.errors.push(error.message ?? 'Failed to fetch brands')
    return result
  }

  for (const brand of data ?? []) {
    result.processed += 1
    config.onProgress?.(`Processing ${brand.slug}`)

    try {
      const visibility = processSetVisibilityBrand(brand)

      if (!visibility.changed || !visibility.patch) {
        result.skipped += 1
        continue
      }

      if (!config.dryRun) {
        const { error: updateError } = await supabase
          .from('brands')
          .update(visibility.patch)
          .eq('id', brand.id)

        if (updateError) {
          result.errors.push(`${brand.slug}: ${updateError.message ?? 'Failed to update brand'}`)
          result.skipped += 1
          continue
        }
      }

      result.updated += 1
    } catch (err) {
      result.errors.push(`${brand.slug}: ${errorMessage(err)}`)
      result.skipped += 1
    }
  }

  return result
}
