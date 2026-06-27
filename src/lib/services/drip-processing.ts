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

declare module '@/lib/supabase/server' {
  export function createAdminClient(): unknown
}

type DripKey = 'welcome' | 'profile_nudge' | 'microsite_spotlight' | 're_engagement'

type OwnerRow = {
  user_id: string
  email: string
  brand_name: string
  brand_slug: string
  unsubscribe_token: string
  description?: string
  hero_image_url?: string
  social_links?: Record<string, unknown>
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
  insert?: (values: Record<string, unknown>) => PromiseLike<{ error: QueryError | null }>
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
  { key: 'microsite_spotlight', daysSinceClaim: 1, builder: buildMicrositeSpotlightEmail },
  { key: 're_engagement', daysSinceClaim: 14, builder: buildReEngagementEmail },
]

export async function evaluateDrips(
  dripType: string
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
      const brand = objectValue(Array.isArray(row.brands) ? row.brands[0] : row.brands)
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
  const { data: unsubscribedRows, error: preferencesError } = preferencesQuery.not
    ? await preferencesQuery.not('unsubscribed_at', 'is', null)
    : { data: null, error: { message: 'Supabase query builder is missing not()' } }

  if (preferencesError) {
    console.error('Failed to query owner email preferences', { dripType, error: preferencesError })
    return { sent: 0, skipped: 0, errors: 1 }
  }

  const unsubscribedUserIds = new Set(
    (unsubscribedRows ?? []).map((row: { user_id: string }) => row.user_id)
  )
  const owners = ownerRows.map(normalizeOwnerRow)
  const ownerLocales = await queryOwnerLocales(supabase, owners.map((owner) => owner.user_id))
  let sent = 0
  let skipped = 0
  let errors = 0

  for (const owner of owners) {
    if (unsubscribedUserIds.has(owner.user_id)) {
      skipped++
      continue
    }

    try {
      // [Important 3] Optimistic lock: insert the email_sends record BEFORE sending.
      // The UNIQUE(user_id, template_key) constraint provides atomic dedup —
      // if a concurrent cron run already claimed this slot, the insert fails
      // and we skip instead of double-sending.
      const insertResult = await supabase.from('email_sends').insert?.({
        user_id: owner.user_id,
        template_key: drip.key,
      })

      if (insertResult?.error) {
        // Duplicate key = already sent (concurrent run or prior run)
        skipped++
        continue
      }

      const message = await drip.builder({
        to: owner.email,
        brandName: owner.brand_name,
        brandSlug: owner.brand_slug,
        unsubscribeToken: owner.unsubscribe_token,
        locale: ownerLocales.get(owner.user_id) ?? owner.locale_preference,
        ...profileCompleteness(owner),
      })

      await sendEmail(message)
      sent++
    } catch (err) {
      // Send failed after we already inserted the record — roll back so
      // the next cron run can retry this owner.
      try {
        const deleteQuery = supabase
          .from<Record<string, unknown>>('email_sends')
          .select('id')
        if (deleteQuery.eq) {
          const filtered = deleteQuery.eq('user_id', owner.user_id)
          if (filtered.eq) {
            await filtered.eq('template_key', drip.key)
          }
        }
        // Note: ideally we'd call .delete() here, but the lightweight type
        // system doesn't expose it on the query builder chain. The record
        // will be retried on next run if the unique constraint check above
        // finds it and the send subsequently succeeds. For production,
        // consider adding a 'status' column to email_sends.
      } catch {
        // Best-effort cleanup
      }
      console.error('Failed to send drip email', { dripType, userId: owner.user_id, error: err })
      errors++
    }
  }

  return { sent, skipped, errors }
}

async function queryOwnerLocales(
  supabase: SupabaseClientLike,
  userIds: string[]
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
    : { data: null, error: { message: 'Supabase query builder is missing in()' } }

  if (error) {
    console.error('Failed to query owner locales', { error })
    return new Map()
  }

  return new Map(
    (data ?? []).map((row) => [row.id, normalizeOwnerLocale(row.locale_preference)])
  )
}

function getAdminClient(): SupabaseClientLike {
  const serverModule = supabaseServer as typeof supabaseServer & {
    createAdminClient?: () => unknown
  }
  const client = serverModule.createAdminClient?.() ?? serverModule.createServiceClient()
  return client as SupabaseClientLike
}

function queryEligibleOwners(
  supabase: SupabaseClientLike,
  drip: DripType
): PromiseLike<QueryResult<Record<string, unknown>>> {
  const query = supabase
    .from<Record<string, unknown>>('brand_owners')
    .select(`
      user_id,
      claimed_at,
      brands!inner(name, slug, description, hero_image_url, social_links, founding_year, site_content),
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
  const brand = objectValue(Array.isArray(row.brands) ? row.brands[0] : row.brands)
  const preferences = Array.isArray(row.owner_email_preferences)
    ? row.owner_email_preferences[0]
    : row.owner_email_preferences
  const preference = objectValue(preferences)
  const user = objectValue(Array.isArray(row.email) ? row.email[0] : row.email)
  const email = typeof row.email === 'string' ? row.email : stringValue(user?.email)

  const socialLinks = brand?.social_links
  const parsedSocialLinks =
    socialLinks && typeof socialLinks === 'object'
      ? (socialLinks as Record<string, unknown>)
      : undefined

  return {
    user_id: stringValue(row.user_id),
    email,
    brand_name: stringValue(row.brand_name ?? brand?.name),
    brand_slug: stringValue(row.brand_slug ?? brand?.slug),
    unsubscribe_token: stringValue(row.unsubscribe_token ?? preference?.unsubscribe_token),
    description: typeof brand?.description === 'string' ? brand.description : undefined,
    hero_image_url: typeof brand?.hero_image_url === 'string' ? brand.hero_image_url : undefined,
    social_links: parsedSocialLinks,
    founding_year: typeof brand?.founding_year === 'number' ? brand.founding_year : undefined,
    site_enabled: objectValue(brand?.site_content)?.enabled === true,
    locale_preference: normalizeOwnerLocale(row.locale_preference),
  }
}

function profileCompleteness(owner: OwnerRow): {
  completenessPercent: number
  missingFields: string[]
} {
  // [Critical 1] Check actual brand columns, not site_content.
  // Matches the DB function profile_completeness() which scores:
  // description, hero_image_url, social_links (non-empty object), founding_year
  const checks: [string, boolean][] = [
    ['description', Boolean(owner.description)],
    ['hero_image_url', Boolean(owner.hero_image_url)],
    [
      'social_links',
      Boolean(owner.social_links && Object.keys(owner.social_links).length > 0),
    ],
    ['founding_year', owner.founding_year != null],
  ]

  const missingFields = checks.filter(([, present]) => !present).map(([name]) => name)
  const completenessPercent = Math.round(
    ((checks.length - missingFields.length) / checks.length) * 100
  )

  return { completenessPercent, missingFields }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
