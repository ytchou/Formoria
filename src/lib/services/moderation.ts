import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import * as supabaseServer from '@/lib/supabase/server'

const SUSPICIOUS_TLDS = ['.tk', '.ml', '.ga', '.cf', '.gq']
const MAX_URLS_IN_TEXT = 3
const MAX_EMOJI_COUNT = 10
const MIN_CJK_DESCRIPTION_CHARS = 10
const TRUSTED_OWNER_THRESHOLD = 3
const ENGLISH_SPAM_PHRASES = ['click here', 'buy now', 'free offer', 'limited time', 'act now']

export type ModerationTier = 'block' | 'flag'
export type RiskLevel = 'clean' | 'medium' | 'high'

export interface ModerationFlag {
  fieldName: string
  tier: ModerationTier
  reason: string
  flaggedContent: string
}

export interface ModerationResult {
  riskLevel: RiskLevel
  flags: ModerationFlag[]
}

export interface ContentPayload {
  fields: Record<string, string | undefined>
  brandName: string
}

type SupabaseServerModule = typeof supabaseServer & {
  createServerClient?: () => SupabaseClient<Database>
}

type ModerationFlagRow = Database['public']['Tables']['moderation_flags']['Row']
type ModerationFlagInsert = Database['public']['Tables']['moderation_flags']['Insert']

const URL_REGEX = /https?:\/\/[^\s]+/gi
const TAIWAN_PHONE_REGEX = /09\d{2}[-.]?\d{3}[-.]?\d{3}/
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
const EMOJI_REGEX = /\p{Emoji_Presentation}/gu
const CJK_REGEX = /[\u4E00-\u9FFF]/g

function createFlag(
  fieldName: string,
  tier: ModerationTier,
  reason: string,
  flaggedContent: string
): ModerationFlag {
  return {
    fieldName,
    tier,
    reason,
    flaggedContent,
  }
}

function extractUrls(value: string): string[] {
  return value.match(URL_REGEX) ?? []
}

function createModerationClient(): SupabaseClient<Database> {
  const serverModule = supabaseServer as SupabaseServerModule
  return serverModule.createServerClient?.() ?? supabaseServer.createServiceClient()
}

function checkSuspiciousTlds(fields: Record<string, string | undefined>): ModerationFlag[] {
  const flags: ModerationFlag[] = []

  for (const [fieldName, value] of Object.entries(fields)) {
    if (!value?.includes('http')) {
      continue
    }

    for (const urlText of extractUrls(value)) {
      try {
        const hostname = new URL(urlText).hostname.toLowerCase()
        const suspiciousTld = SUSPICIOUS_TLDS.find(tld => hostname.endsWith(tld))

        if (suspiciousTld) {
          flags.push(
            createFlag(
              fieldName,
              'block',
              `Suspicious TLD detected: ${suspiciousTld}`,
              urlText
            )
          )
          break
        }
      } catch {
        continue
      }
    }
  }

  return flags
}

function checkExcessiveUrls(fields: Record<string, string | undefined>): ModerationFlag[] {
  const flags: ModerationFlag[] = []

  for (const [fieldName, value] of Object.entries(fields)) {
    if (!value) {
      continue
    }

    const urls = extractUrls(value)

    if (urls.length > MAX_URLS_IN_TEXT) {
      flags.push(
        createFlag(
          fieldName,
          'block',
          `Too many URLs detected: ${urls.length}`,
          value
        )
      )
    }
  }

  return flags
}

function checkEnglishSpam(fields: Record<string, string | undefined>): ModerationFlag[] {
  const flags: ModerationFlag[] = []

  for (const fieldName of ['name', 'website', 'purchaseUrl']) {
    const value = fields[fieldName]

    if (!value) {
      continue
    }

    const lowerValue = value.toLowerCase()
    const spamPhrase = ENGLISH_SPAM_PHRASES.find(phrase => lowerValue.includes(phrase))

    if (spamPhrase) {
      flags.push(
        createFlag(
          fieldName,
          'block',
          `English spam phrase detected: ${spamPhrase}`,
          value
        )
      )
    }
  }

  return flags
}

function checkContactInjection(fields: Record<string, string | undefined>): ModerationFlag[] {
  const flags: ModerationFlag[] = []

  for (const fieldName of ['description', 'mitStory']) {
    const value = fields[fieldName]

    if (!value) {
      continue
    }

    if (TAIWAN_PHONE_REGEX.test(value)) {
      flags.push(
        createFlag(
          fieldName,
          'flag',
          'Taiwan phone number detected',
          value
        )
      )
    }

    if (EMAIL_REGEX.test(value)) {
      flags.push(
        createFlag(
          fieldName,
          'flag',
          'Email address detected',
          value
        )
      )
    }
  }

  return flags
}

function checkExcessiveEmoji(fields: Record<string, string | undefined>): ModerationFlag[] {
  const flags: ModerationFlag[] = []

  for (const [fieldName, value] of Object.entries(fields)) {
    if (!value) {
      continue
    }

    const emojiCount = value.match(EMOJI_REGEX)?.length ?? 0

    if (emojiCount > MAX_EMOJI_COUNT) {
      flags.push(
        createFlag(
          fieldName,
          'flag',
          `Too many emoji detected: ${emojiCount}`,
          value
        )
      )
    }
  }

  return flags
}

function checkShortOrIdenticalDescription(
  fields: Record<string, string | undefined>,
  brandName: string
): ModerationFlag[] {
  const description = fields.description

  if (!description) {
    return []
  }

  const flags: ModerationFlag[] = []
  const cjkCount = description.match(CJK_REGEX)?.length ?? 0

  if (cjkCount >= 3 && cjkCount < MIN_CJK_DESCRIPTION_CHARS) {
    flags.push(
      createFlag(
        'description',
        'flag',
        `Description has fewer than ${MIN_CJK_DESCRIPTION_CHARS} CJK characters`,
        description
      )
    )
  }

  if (description.trim() === brandName.trim()) {
    flags.push(
      createFlag(
        'description',
        'flag',
        'Description is identical to brand name',
        description
      )
    )
  }

  return flags
}

export function scanContent(payload: ContentPayload): ModerationResult {
  const { fields, brandName } = payload
  const tier1Flags = [
    ...checkSuspiciousTlds(fields),
    ...checkExcessiveUrls(fields),
    ...checkEnglishSpam(fields),
  ]
  const tier2Flags = [
    ...checkContactInjection(fields),
    ...checkExcessiveEmoji(fields),
    ...checkShortOrIdenticalDescription(fields, brandName),
  ]
  const allFlags = [...tier1Flags, ...tier2Flags]
  const riskLevel: RiskLevel = tier1Flags.length > 0 ? 'high' : tier2Flags.length > 0 ? 'medium' : 'clean'
  return { riskLevel, flags: allFlags }
}

export async function shouldAutoApprove(result: ModerationResult, userId: string): Promise<boolean> {
  if (result.flags.length > 0) return false

  try {
    const supabase = createModerationClient()
    const { count, error } = await supabase
      .from('pending_brand_edits')
      .select('*', { count: 'exact', head: true })
      .eq('submitted_by', userId)
      .eq('status', 'approved')

    if (error || count === null) return false
    return count >= TRUSTED_OWNER_THRESHOLD
  } catch {
    return false
  }
}

export async function saveModerationFlags(
  brandId: string,
  userId: string,
  flags: ModerationFlag[]
): Promise<void> {
  const supabase = createModerationClient()
  const rows: ModerationFlagInsert[] = flags.map(flag => ({
    brand_id: brandId,
    user_id: userId,
    field_name: flag.fieldName,
    flag_reason: flag.reason,
    flagged_content: flag.flaggedContent,
    tier: flag.tier,
    status: 'pending',
  }))
  const { error } = await supabase.from('moderation_flags').insert(rows)
  if (error) throw error
}

export async function getModerationFlagsBatch(
  brandIds: string[]
): Promise<Map<string, ModerationFlag[]>> {
  const uniqueBrandIds = Array.from(new Set(brandIds.filter(Boolean)))
  const flagsByBrandId = new Map<string, ModerationFlag[]>()

  for (const brandId of uniqueBrandIds) {
    flagsByBrandId.set(brandId, [])
  }

  if (uniqueBrandIds.length === 0) {
    return flagsByBrandId
  }

  const supabase = createModerationClient()
  const { data, error } = await supabase
    .from('moderation_flags')
    .select('*')
    .in('brand_id', uniqueBrandIds)
    .neq('status', 'reviewed')
    .order('created_at', { ascending: false })

  if (error || !data) return flagsByBrandId

  for (const row of data) {
    const flags = flagsByBrandId.get(row.brand_id) ?? []
    flags.push({
      fieldName: row.field_name,
      tier: row.tier as ModerationTier,
      reason: row.flag_reason,
      flaggedContent: row.flagged_content,
    })
    flagsByBrandId.set(row.brand_id, flags)
  }

  return flagsByBrandId
}

export interface FlaggedContentFilters {
  riskLevel?: string
  tier?: string
  status?: string
  cursor?: string
  limit?: number
}

export interface FlaggedContentItem {
  id: string
  brandId: string
  brandName: string
  fieldName: string
  tier: ModerationTier
  reason: string
  flaggedContent: string
  status: string
  createdAt: string
}

type FlaggedContentRow = ModerationFlagRow & {
  brands: { name: string | null } | { name: string | null }[] | null
}

function getJoinedBrandName(brands: FlaggedContentRow['brands']): string {
  const brand = Array.isArray(brands) ? brands[0] : brands
  return brand?.name ?? ''
}

export async function getFlaggedContent(filters: FlaggedContentFilters = {}): Promise<{
  items: FlaggedContentItem[]
  nextCursor: string | null
}> {
  const supabase = createModerationClient()
  const limit = filters.limit ?? 20
  let query = supabase
    .from('moderation_flags')
    .select('*, brands(name)')
    .order('created_at', { ascending: false })
    .limit(limit + 1)

  if (filters.status) query = query.eq('status', filters.status)
  if (filters.tier) query = query.eq('tier', filters.tier)
  if (filters.cursor) query = query.lt('created_at', filters.cursor)

  const { data, error } = await query
  if (error || !data) return { items: [], nextCursor: null }

  const hasMore = data.length > limit
  const rows = (hasMore ? data.slice(0, limit) : data) as FlaggedContentRow[]
  const items: FlaggedContentItem[] = rows.map(row => ({
    id: row.id,
    brandId: row.brand_id,
    brandName: getJoinedBrandName(row.brands),
    fieldName: row.field_name,
    tier: row.tier as ModerationTier,
    reason: row.flag_reason,
    flaggedContent: row.flagged_content,
    status: row.status,
    createdAt: row.created_at,
  }))
  return {
    items,
    nextCursor: hasMore ? rows[rows.length - 1].created_at : null,
  }
}

export async function markFlagsReviewed(brandId: string): Promise<void> {
  const supabase = createModerationClient()
  const { error } = await supabase
    .from('moderation_flags')
    .update({ status: 'reviewed', reviewed_at: new Date().toISOString() })
    .eq('brand_id', brandId)
    .eq('status', 'pending')

  if (error) console.error('[moderation] markFlagsReviewed failed:', error)
}
