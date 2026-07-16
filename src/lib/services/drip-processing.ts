import {
  buildMicrositeSpotlightEmail,
  buildProfileNudgeEmail,
  buildReEngagementEmail,
  buildWelcomeEmail,
} from '@/lib/email/templates'
import { sendEmail } from '@/lib/email/send'
import * as supabaseServer from '@/lib/supabase/server'
import type { EmailMessage } from '@/lib/email/types'
import { normalizeOwnerLocale, type OwnerLocale } from '@/lib/types'
import type { RetailLocation } from '@/lib/types/brand'
import { normalizeRetailLocations } from '@/lib/brands/locations'
import { computeProfileCompleteness } from '@/lib/services/profile-completeness'

declare module '@/lib/supabase/server' {
  export function createAdminClient(): unknown
}

type DripKey =
  | 'welcome'
  | 'profile_nudge'
  | 'microsite_spotlight'
  | 're_engagement'

type OwnerRow = {
  user_id: string
  email: string
  brand_name: string
  brand_slug: string
  unsubscribe_token: string
  description?: string
  hero_image_url?: string
  product_photos: string[]
  product_tags: string[]
  price_range?: number
  purchase_website?: string
  city?: string
  social_instagram?: string
  social_threads?: string
  social_facebook?: string
  purchase_pinkoi?: string
  purchase_shopee?: string
  other_urls: { label: string; url: string }[]
  retail_locations: RetailLocation[]
  reputation_summary?: { text: string; sources: { url: string }[] }
  founding_year?: number
  site_enabled?: boolean
  locale_preference: OwnerLocale
}

type QueryResult<T> = {
  data: T[] | null
  error: QueryError | null
}

type QueryError = {
  message?: string
}

type QueryBuilder<T> = PromiseLike<QueryResult<T>> & {
  eq?: (column: string, value: string) => QueryBuilder<T>
  is?: (column: string, value: null) => QueryBuilder<T>
  in?: (column: string, value: string[]) => QueryBuilder<T>
  lt?: (column: string, value: string) => QueryBuilder<T>
  not?: (column: string, operator: string, value: unknown) => QueryBuilder<T>
}

type SupabaseTable<T> = {
  select: (columns: string) => QueryBuilder<T>
  insert?: (
    values: Record<string, unknown>,
  ) => PromiseLike<{ error: QueryError | null }>
  delete?: () => QueryBuilder<T>
}

type SupabaseClientLike = {
  from: <T>(table: string) => SupabaseTable<T>
}

type DripBuilderProps = {
  to: string
  brandName: string
  brandSlug: string
  unsubscribeToken: string
  completenessPercent: number
  missingFields: string[]
  locale: OwnerLocale
}

type DripType = {
  key: DripKey
  daysSinceClaim: number
  builder: (props: DripBuilderProps) => Promise<EmailMessage>
}

export const DRIP_TYPES: DripType[] = [
  { key: 'welcome', daysSinceClaim: 1, builder: buildWelcomeEmail },
  { key: 'profile_nudge', daysSinceClaim: 3, builder: buildProfileNudgeEmail },
  {
    key: 'microsite_spotlight',
    daysSinceClaim: 1,
    builder: buildMicrositeSpotlightEmail,
  },
  { key: 're_engagement', daysSinceClaim: 14, builder: buildReEngagementEmail },
]

export async function evaluateDrips(
  dripType: string,
): Promise<{ sent: number; skipped: number; errors: number }> {
  const drip = DRIP_TYPES.find((type) => type.key === dripType)
  if (!drip) {
    throw new Error(`Unknown drip type: ${dripType}`)
  }

  const supabase = getAdminClient()
  const { data, error } = await queryEligibleOwners(supabase, drip)

  if (error) {
    console.error('Failed to query drip owners', { dripType, error })
    return { sent: 0, skipped: 0, errors: 1 }
  }

  let ownerRows = data ?? []

  // [Critical 2] PostgREST cannot filter on JSON path in embedded resources.
  // Filter microsite_spotlight owners in JS after fetching.
  if (drip.key === 'microsite_spotlight') {
    ownerRows = ownerRows.filter((row) => {
      const brand = objectValue(
        Array.isArray(row.brands) ? row.brands[0] : row.brands,
      )
      const siteContent = objectValue(brand?.site_content)
      return siteContent?.enabled === true || siteContent?.enabled === 'true'
    })
  }

  if (ownerRows.length === 0) {
    return { sent: 0, skipped: 0, errors: 0 }
  }

  const preferencesQuery = supabase
    .from<{ user_id: string }>('owner_email_preferences')
    .select('user_id')
  const optedInQuery = preferencesQuery.not?.(
    'lifecycle_opted_in_at',
    'is',
    null,
  )
  const { data: activePreferenceRows, error: preferencesError } =
    optedInQuery?.is
      ? await optedInQuery.is('unsubscribed_at', null)
      : {
          data: null,
          error: { message: 'Supabase query builder is missing consent filters' },
        }

  if (preferencesError) {
    console.error('Failed to query owner email preferences', {
      dripType,
      error: preferencesError,
    })
    return { sent: 0, skipped: 0, errors: 1 }
  }

  const optedInUserIds = new Set(
    (activePreferenceRows ?? []).map((row: { user_id: string }) => row.user_id),
  )
  const owners = ownerRows.map(normalizeOwnerRow)
  const optedInOwners = owners.filter((owner) =>
    optedInUserIds.has(owner.user_id),
  )
  const ownerLocales = await queryOwnerLocales(
    supabase,
    optedInOwners.map((owner) => owner.user_id),
  )
  const BATCH_SIZE = 5
  const results: ('sent' | 'skipped' | 'error')[] = []
  for (let i = 0; i < optedInOwners.length; i += BATCH_SIZE) {
    const batch = optedInOwners.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(batch.map(async (owner) => {
      try {
        const insertResult = await supabase.from('email_sends').insert?.({
          user_id: owner.user_id,
          template_key: drip.key,
        })

        if (insertResult?.error) {
          return 'skipped' as const
        }

        const message = await drip.builder({
          to: owner.email,
          brandName: owner.brand_name,
          brandSlug: owner.brand_slug,
          unsubscribeToken: owner.unsubscribe_token,
          locale: ownerLocales.get(owner.user_id) ?? owner.locale_preference,
          ...profileCompleteness(owner),
        })

        const delivery = await sendEmail(message)
        if (!delivery.success) {
          throw new Error(delivery.error ?? 'Email delivery failed')
        }
        return 'sent' as const
      } catch (err) {
        try {
          const deleteQuery = supabase
            .from<Record<string, unknown>>('email_sends')
            .delete?.()
          if (deleteQuery?.eq) {
            const filtered = deleteQuery.eq('user_id', owner.user_id)
            if (filtered.eq) {
              await filtered.eq('template_key', drip.key)
            }
          }
        } catch {
          // Best-effort cleanup
        }
        console.error('Failed to send drip email', {
          dripType,
          userId: owner.user_id,
          error: err,
        })
        return 'error' as const
      }
    }))
    results.push(...batchResults)
  }

  return {
    sent: results.filter((result) => result === 'sent').length,
    skipped:
      owners.length - optedInOwners.length +
      results.filter((result) => result === 'skipped').length,
    errors: results.filter((result) => result === 'error').length,
  }
}

async function queryOwnerLocales(
  supabase: SupabaseClientLike,
  userIds: string[],
): Promise<Map<string, OwnerLocale>> {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)))
  if (uniqueUserIds.length === 0) {
    return new Map()
  }

  const query = supabase
    .from<{ id: string; locale_preference: string | null }>('profiles')
    .select('id, locale_preference')

  const { data, error } = query.in
    ? await query.in('id', uniqueUserIds)
    : {
        data: null,
        error: { message: 'Supabase query builder is missing in()' },
      }

  if (error) {
    console.error('Failed to query owner locales', { error })
    return new Map()
  }

  return new Map(
    (data ?? []).map((row) => [
      row.id,
      normalizeOwnerLocale(row.locale_preference),
    ]),
  )
}

function getAdminClient(): SupabaseClientLike {
  const serverModule = supabaseServer as typeof supabaseServer & {
    createAdminClient?: () => unknown
  }
  const client =
    serverModule.createAdminClient?.() ?? serverModule.createServiceClient()
  return client as SupabaseClientLike
}

function queryEligibleOwners(
  supabase: SupabaseClientLike,
  drip: DripType,
): PromiseLike<QueryResult<Record<string, unknown>>> {
  const query = supabase.from<Record<string, unknown>>('brand_owners').select(`
      user_id,
      claimed_at,
      brands!inner(name, slug, description, hero_image_url, founding_year, product_tags, price_range, purchase_website, city, social_instagram, social_threads, social_facebook, purchase_pinkoi, purchase_shopee, other_urls, retail_locations, reputation_summary, site_content, brand_images(url, status, sort_order)),
      owner_email_preferences!inner(unsubscribe_token),
      email:users!brand_owners_user_id_fkey(email)
    `)

  if (query.lt) {
    return query.lt('claimed_at', daysAgo(drip.daysSinceClaim))
  }

  return query
}

function daysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString()
}

function normalizeOwnerRow(row: Record<string, unknown>): OwnerRow {
  const brand = objectValue(
    Array.isArray(row.brands) ? row.brands[0] : row.brands,
  )
  const preferences = Array.isArray(row.owner_email_preferences)
    ? row.owner_email_preferences[0]
    : row.owner_email_preferences
  const preference = objectValue(preferences)
  const user = objectValue(Array.isArray(row.email) ? row.email[0] : row.email)
  const email =
    typeof row.email === 'string' ? row.email : stringValue(user?.email)

  const images = Array.isArray(brand?.brand_images)
    ? brand.brand_images
        .filter((image) => objectValue(image)?.status === 'active')
        .toSorted(
          (left, right) =>
            Number(objectValue(left)?.sort_order ?? 0) -
            Number(objectValue(right)?.sort_order ?? 0),
        )
    : []

  return {
    user_id: stringValue(row.user_id),
    email,
    brand_name: stringValue(row.brand_name ?? brand?.name),
    brand_slug: stringValue(row.brand_slug ?? brand?.slug),
    unsubscribe_token: stringValue(
      row.unsubscribe_token ?? preference?.unsubscribe_token,
    ),
    description:
      typeof brand?.description === 'string' ? brand.description : undefined,
    hero_image_url:
      typeof brand?.hero_image_url === 'string'
        ? brand.hero_image_url
        : undefined,
    product_photos: images
      .slice(1)
      .map((image) => stringValue(objectValue(image)?.url))
      .filter(Boolean),
    product_tags: Array.isArray(brand?.product_tags)
      ? brand.product_tags.filter(
          (tag): tag is string => typeof tag === 'string',
        )
      : [],
    price_range:
      typeof brand?.price_range === 'number' ? brand.price_range : undefined,
    purchase_website: stringValue(brand?.purchase_website) || undefined,
    city: stringValue(brand?.city) || undefined,
    social_instagram: stringValue(brand?.social_instagram) || undefined,
    social_threads: stringValue(brand?.social_threads) || undefined,
    social_facebook: stringValue(brand?.social_facebook) || undefined,
    purchase_pinkoi: stringValue(brand?.purchase_pinkoi) || undefined,
    purchase_shopee: stringValue(brand?.purchase_shopee) || undefined,
    other_urls: Array.isArray(brand?.other_urls)
      ? (brand.other_urls as OwnerRow['other_urls'])
      : [],
    retail_locations: normalizeRetailLocations(brand?.retail_locations),
    reputation_summary: objectValue(
      brand?.reputation_summary,
    ) as OwnerRow['reputation_summary'],
    founding_year:
      typeof brand?.founding_year === 'number'
        ? brand.founding_year
        : undefined,
    site_enabled: objectValue(brand?.site_content)?.enabled === true,
    locale_preference: normalizeOwnerLocale(row.locale_preference),
  }
}

function profileCompleteness(owner: OwnerRow): {
  completenessPercent: number
  missingFields: string[]
} {
  const completeness = computeProfileCompleteness({
    description: owner.description ?? null,
    productTags: owner.product_tags,
    priceRange: owner.price_range ?? null,
    heroImageUrl: owner.hero_image_url ?? null,
    productPhotos: owner.product_photos,
    purchaseWebsite: owner.purchase_website ?? null,
    city: owner.city ?? null,
    foundingYear: owner.founding_year ?? null,
    socialInstagram: owner.social_instagram ?? null,
    socialThreads: owner.social_threads ?? null,
    socialFacebook: owner.social_facebook ?? null,
    purchasePinkoi: owner.purchase_pinkoi ?? null,
    purchaseShopee: owner.purchase_shopee ?? null,
    otherUrls: owner.other_urls,
    retailLocations: owner.retail_locations,
    reputationSummary: owner.reputation_summary ?? null,
  })

  return {
    completenessPercent: completeness.score,
    missingFields: completeness.recommendations.map(
      (component) => component.key,
    ),
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
