import type { Brand, PendingBrandEdit, PendingBrandEditWithBrand } from '@/lib/types/brand'
import type { Database } from '@/lib/supabase/database.types'
import { createServiceClient } from '@/lib/supabase/server'
import { deleteBrandImages } from '@/lib/services/image-upload'
import { diffRemovedImageUrls, updateBrand } from './brands'
import { deriveCategoryFromProductType } from '@/lib/taxonomy/ontology'

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

type PendingBrandEditRow = Database['public']['Tables']['pending_brand_edits']['Row']
type BrandRow = Database['public']['Tables']['brands']['Row']
type BrandFlatLinkColumns = {
  social_instagram?: string | null
  social_threads?: string | null
  social_facebook?: string | null
  purchase_website?: string | null
  purchase_pinkoi?: string | null
  purchase_shopee?: string | null
  other_urls?: unknown
}
type PendingBrandEditStatus = PendingBrandEdit['status']

type PendingBrandEditRowInput = Pick<PendingBrandEditRow, 'id'> &
  Partial<Omit<PendingBrandEditRow, 'id'>>

type PendingBrandEditWithBrandRowInput = PendingBrandEditRowInput & {
  brands?: Partial<BrandRow> | Partial<BrandRow>[] | null
}

type ApprovedPendingEditWithBrandRow = PendingBrandEditWithBrandRowInput &
  Pick<PendingBrandEditRow, 'brand_id' | 'proposed_data'>

type PendingEditReviewRow = {
  brand_id: string
  brands: { name: string | null } | { name: string | null }[] | null
}

const PENDING_EDIT_WITH_BRAND_SELECT =
  '*, brands(id, name, slug, description, logo_url, hero_image_url, product_type, contact_email, brand_highlights, founding_year, social_instagram, social_threads, social_facebook, purchase_website, purchase_pinkoi, purchase_shopee, other_urls, retail_locations, product_photos, site_content)'

function asSingleBrand(
  brand: Partial<BrandRow> | Partial<BrandRow>[] | null | undefined
): (Partial<BrandRow> & BrandFlatLinkColumns) | null {
  if (Array.isArray(brand)) return brand[0] ?? null
  return brand ?? null
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function pendingEditToDomain(row: PendingBrandEditRowInput): PendingBrandEdit {
  return {
    id: row.id,
    brandId: row.brand_id ?? '',
    submittedBy: row.submitted_by ?? '',
    proposedData: (row.proposed_data as Record<string, unknown>) ?? {},
    status: (row.status as PendingBrandEditStatus) ?? 'pending',
    reviewerNotes: row.reviewer_notes ?? null,
    reviewedAt: row.reviewed_at ?? null,
    reviewedBy: row.reviewed_by ?? null,
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? '',
  }
}

function proposedStringOrNull(
  proposedData: Record<string, unknown>,
  key: keyof Pick<
    Brand,
    | 'socialInstagram'
    | 'socialThreads'
    | 'socialFacebook'
    | 'purchaseWebsite'
    | 'purchasePinkoi'
    | 'purchaseShopee'
  >,
  current: string | null | undefined
): string | null {
  if (!(key in proposedData)) return current ?? null
  const value = proposedData[key]
  return typeof value === 'string' ? value : null
}

function proposedOtherUrls(
  proposedData: Record<string, unknown>,
  current: unknown
): Brand['otherUrls'] {
  if ('otherUrls' in proposedData) {
    return Array.isArray(proposedData.otherUrls) ? proposedData.otherUrls as Brand['otherUrls'] : []
  }
  return Array.isArray(current) ? current as Brand['otherUrls'] : []
}

export function pendingEditWithBrandToDomain(
  row: PendingBrandEditWithBrandRowInput
): PendingBrandEditWithBrand {
  const edit = pendingEditToDomain(row)
  const brand = asSingleBrand(row.brands)
  const proposedData = edit.proposedData
  return {
    ...edit,
    brand: {
      id: brand?.id ?? edit.brandId,
      name: brand?.name ?? '',
      slug: brand?.slug ?? '',
      description: brand?.description ?? null,
      logoUrl: brand?.logo_url ?? null,
      heroImageUrl: brand?.hero_image_url ?? null,
      category: deriveCategoryFromProductType(brand?.product_type ?? '') ?? null,
      contactEmail: brand?.contact_email ?? null,
      brandHighlights: brand?.brand_highlights ?? null,
      foundingYear: brand?.founding_year ?? null,
      socialInstagram: proposedStringOrNull(proposedData, 'socialInstagram', brand?.social_instagram),
      socialThreads: proposedStringOrNull(proposedData, 'socialThreads', brand?.social_threads),
      socialFacebook: proposedStringOrNull(proposedData, 'socialFacebook', brand?.social_facebook),
      purchaseWebsite: proposedStringOrNull(proposedData, 'purchaseWebsite', brand?.purchase_website),
      purchasePinkoi: proposedStringOrNull(proposedData, 'purchasePinkoi', brand?.purchase_pinkoi),
      purchaseShopee: proposedStringOrNull(proposedData, 'purchaseShopee', brand?.purchase_shopee),
      otherUrls: proposedOtherUrls(proposedData, brand?.other_urls),
      retailLocations: Array.isArray(brand?.retail_locations) ? brand.retail_locations as Brand['retailLocations'] : [],
      productPhotos: Array.isArray(brand?.product_photos) ? brand.product_photos.filter((url): url is string => typeof url === 'string') : [],
      siteContent: brand?.site_content && typeof brand.site_content === 'object' && !Array.isArray(brand.site_content)
        ? brand.site_content as Brand['siteContent']
        : null,
    },
  }
}

function pendingEditToUpsert(
  brandId: string,
  submittedBy: string,
  proposedData: Record<string, unknown>
): Record<string, unknown> {
  return {
    brand_id: brandId,
    submitted_by: submittedBy,
    proposed_data: proposedData,
    status: 'pending',
    reviewer_notes: null,
    reviewed_at: null,
    reviewed_by: null,
  }
}

function isNoRowsError(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST116'
}

function imageUrlsFromBrand(brand: Pick<Brand, 'logoUrl' | 'heroImageUrl' | 'productPhotos'>): string[] {
  return [
    brand.logoUrl,
    brand.heroImageUrl,
    ...(brand.productPhotos ?? []),
  ].filter((url): url is string => Boolean(url))
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function createPendingEdit(
  brandId: string,
  userId: string,
  proposedData: Record<string, unknown>
): Promise<PendingBrandEdit> {
  const supabase = createServiceClient()

  const { data: existing } = await supabase
    .from('pending_brand_edits')
    .select('id')
    .eq('brand_id', brandId)
    .eq('status', 'pending')
    .maybeSingle()

  if (existing) {
    const { data, error } = await supabase
      .from('pending_brand_edits')
      .update({ proposed_data: proposedData, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('*')
      .single()
    if (error) throw error
    return pendingEditToDomain(data)
  }

  const { data, error } = await supabase
    .from('pending_brand_edits')
    .insert(pendingEditToUpsert(brandId, userId, proposedData))
    .select('*')
    .single()
  if (error) throw error
  return pendingEditToDomain(data)
}

export async function getPendingEdits(
  status?: PendingBrandEditStatus,
  options?: { limit?: number }
): Promise<PendingBrandEditWithBrand[]> {
  const supabase = createServiceClient()
  let query = supabase.from('pending_brand_edits').select(PENDING_EDIT_WITH_BRAND_SELECT)

  if (status) {
    query = query.eq('status', status)
  }

  query = query.order('created_at', { ascending: false })
  if (options?.limit) {
    query = query.limit(options.limit)
  }

  const { data, error } = await query

  if (error) throw error
  return ((data ?? []) as PendingBrandEditWithBrandRowInput[]).map(pendingEditWithBrandToDomain)
}

export async function getPendingEdit(brandId: string): Promise<PendingBrandEdit | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('pending_brand_edits')
    .select('*')
    .eq('brand_id', brandId)
    .eq('status', 'pending')
    .single()

  if (isNoRowsError(error)) return null
  if (error) throw error
  return data ? pendingEditToDomain(data) : null
}

export async function getPendingEditCount(): Promise<number> {
  const supabase = createServiceClient()
  const { count, error } = await supabase
    .from('pending_brand_edits')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')

  if (error) throw error
  return count ?? 0
}

export async function approvePendingEdit(id: string, reviewerId: string): Promise<void> {
  const supabase = createServiceClient()
  const { data, error, count } = await supabase
    .from('pending_brand_edits')
    .update(
      {
        status: 'approved',
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewerId,
      },
      { count: 'exact' }
    )
    .eq('id', id)
    .eq('status', 'pending')
    .select(PENDING_EDIT_WITH_BRAND_SELECT)
    .single()

  if (isNoRowsError(error) || count === 0 || !data) {
    throw new Error('Pending edit already processed')
  }
  if (error) throw error

  const approvedEdit = data as ApprovedPendingEditWithBrandRow
  let updatedBrand: Brand | null = null
  try {
    updatedBrand = await updateBrand(approvedEdit.brand_id, approvedEdit.proposed_data as Partial<Brand>)
  } catch (updateError) {
    console.error('[pending-edits:approvePendingEdit] updateBrand failed after approval:', updateError)
    return
  }

  const previousBrand = pendingEditWithBrandToDomain(approvedEdit).brand
  const removedImageUrls = diffRemovedImageUrls(
    imageUrlsFromBrand(previousBrand),
    imageUrlsFromBrand(updatedBrand)
  )
  await deleteBrandImages(removedImageUrls)
}

export async function rejectPendingEdit(
  id: string,
  reviewerId: string,
  notes?: string
): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('pending_brand_edits')
    .update({
      status: 'rejected',
      reviewer_notes: notes ?? null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerId,
    })
    .eq('id', id)

  if (error) throw error
}

export async function hasPendingEdit(brandId: string): Promise<boolean> {
  try {
    const pendingEdit = await getPendingEdit(brandId)
    return pendingEdit !== null
  } catch (error) {
    if (isNoRowsError(error as { code?: string })) return false
    throw error
  }
}

export async function getLatestEditReview(
  brandId: string,
  submittedBy: string
): Promise<PendingBrandEdit | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('pending_brand_edits')
    .select('*')
    .eq('brand_id', brandId)
    .eq('submitted_by', submittedBy)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (isNoRowsError(error)) return null
  if (error) throw error
  return data ? pendingEditToDomain(data) : null
}

export async function getPendingEditForReview(
  editId: string
): Promise<{ brandId: string; brandName: string }> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('pending_brand_edits')
    .select('brand_id, brands(name)')
    .eq('id', editId)
    .single()

  if (error) throw error

  const row = data as PendingEditReviewRow
  const brand = Array.isArray(row.brands) ? row.brands[0] : row.brands

  return {
    brandId: row.brand_id,
    brandName: brand?.name ?? '',
  }
}
