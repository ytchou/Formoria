import type { Database } from '@/lib/supabase/database.types'

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

type ModerationFlagRow = Database['public']['Tables']['moderation_flags']['Row']

/** Shape returned by: moderation_flags.select('*, brands(name, slug)') */
type ModerationFlagRowWithBrand = ModerationFlagRow & {
  brands: { name: string; slug: string } | null
}

export type FieldError = {
  field: string
  reason: string
}

export type FieldFlag = {
  field: string
  content: string
  reason: string
  tier: 'flag'
}

export type ModerationResult = {
  blocked: FieldError[]
  flagged: FieldFlag[]
  isBlocked: boolean
}

// Tier 1: content that must be blocked immediately
const TIER1_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bviagra\b/i, reason: 'Pharmaceutical spam detected' },
  { pattern: /\bcialis\b/i, reason: 'Pharmaceutical spam detected' },
  { pattern: /\bcasino\b/i, reason: 'Gambling content detected' },
  { pattern: /\bpoker\b/i, reason: 'Gambling content detected' },
  { pattern: /\bslot\s*machine/i, reason: 'Gambling content detected' },
  { pattern: /\bcrypto\s*invest/i, reason: 'Cryptocurrency spam detected' },
  { pattern: /\bbuy\s+cheap\b/i, reason: 'Spam pattern detected' },
  { pattern: /\bfree\s+money\b/i, reason: 'Spam pattern detected' },
  { pattern: /\bmake\s+money\s+fast\b/i, reason: 'Spam pattern detected' },
  { pattern: /\bsex\s*(toy|shop|pill)/i, reason: 'Adult content detected' },
  { pattern: /\bporn\b/i, reason: 'Adult content detected' },
  { pattern: /\bxxx\b/i, reason: 'Adult content detected' },
  { pattern: /\b(buy|order)\s+(now|today)\b/i, reason: 'SEO spam detected' },
  { pattern: /\b(mlm|pyramid\s+scheme|downline|upline|recruit.*earn)\b/i, reason: 'MLM or pyramid scheme language' },
  { pattern: /\b(guaranteed\s+results|100%\s+effective|clinically\s+proven)\b/i, reason: 'Unverifiable marketing claims' },
  { pattern: /\b(miracle\s+cure|lose\s+weight\s+fast|instant\s+results)\b/i, reason: 'Health fraud language' },
  { pattern: /\b(verify\s+your\s+account|click\s+here\s+to\s+claim|limited\s+time\s+offer)\b/i, reason: 'Phishing or scam language' },
]

// Tier 2: content that should be flagged for review
function checkTier2(fieldName: string, value: string, fields: Record<string, string>): FieldFlag[] {
  const flags: FieldFlag[] = []

  // Excessive URLs (more than 3 http/https links)
  const urlMatches = value.match(/https?:\/\//g)
  if (urlMatches && urlMatches.length > 3) {
    flags.push({
      field: fieldName,
      content: value,
      reason: 'Excessive URLs detected (more than 3 links)',
      tier: 'flag',
    })
  }

  // All-caps blocks (more than 30 consecutive uppercase characters)
  if (/[A-Z\s]{30,}/.test(value) && value === value.toUpperCase() && value.length > 30) {
    flags.push({
      field: fieldName,
      content: value,
      reason: 'Large block of all-caps text detected',
      tier: 'flag',
    })
  }

  // Suspicious contact patterns (phone numbers, email addresses in content)
  const phonePattern = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/
  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/
  if (phonePattern.test(value) || emailPattern.test(value)) {
    flags.push({
      field: fieldName,
      content: value,
      reason: 'Contact information detected in content',
      tier: 'flag',
    })
  }

  // Duplicate name/description
  if (fieldName === 'description' && fields['name'] &&
      value.trim() === fields['name'].trim() && value.trim().length > 5) {
    flags.push({ field: fieldName, content: value, reason: 'duplicate of brand name', tier: 'flag' })
  }

  // Very short description (under 20 chars)
  if (fieldName === 'description' && value.trim().length < 20) {
    flags.push({ field: fieldName, content: value, reason: 'description too short to be meaningful', tier: 'flag' })
  }

  // Excessive emoji (count codepoints in emoji ranges)
  const emojiCount = [...value].filter(c => /\p{Emoji}/u.test(c) && c.charCodeAt(0) > 127).length
  if (emojiCount > 10) {
    flags.push({ field: fieldName, content: value, reason: `excessive emoji (${emojiCount})`, tier: 'flag' })
  }

  // Suspicious TLD for URL fields
  if (fieldName === 'websiteUrl') {
    const suspiciousTlds = ['.tk', '.ml', '.ga', '.cf']
    const hasSuspiciousTld = suspiciousTlds.some(tld => {
      const url = value.toLowerCase()
      // Match TLD at end of domain (before path/query/fragment or end of string)
      const tldPattern = new RegExp(`\\${tld}(?:[/?#]|$)`)
      return tldPattern.test(url)
    })
    if (hasSuspiciousTld) {
      flags.push({ field: fieldName, content: value, reason: 'suspicious domain TLD', tier: 'flag' })
    }
  }

  return flags
}

export type ModerationFlag = {
  id: string
  brandId: string
  brandName: string | null
  brandSlug: string | null
  userId: string
  fieldName: string
  flaggedContent: string
  previousContent: string | null
  flagReason: string
  tier: string
  status: string
  reviewedAt: string | null
  createdAt: string
}

function flagToDomain(row: ModerationFlagRowWithBrand): ModerationFlag {
  return {
    id: row.id,
    brandId: row.brand_id,
    brandName: row.brands?.name ?? null,
    brandSlug: row.brands?.slug ?? null,
    userId: row.user_id,
    fieldName: row.field_name,
    flaggedContent: row.flagged_content,
    previousContent: row.previous_content ?? null,
    flagReason: row.flag_reason,
    tier: row.tier,
    status: row.status,
    reviewedAt: row.reviewed_at ?? null,
    createdAt: row.created_at,
  }
}

export async function getPendingFlags(): Promise<ModerationFlag[]> {
  const { createServiceClient } = await import('@/lib/supabase/server')
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('moderation_flags')
    .select('*, brands(name, slug)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (error) throw error

  // Cast to typed join shape — Supabase's select return type doesn't track the brands join
  const rows = (data ?? []) as unknown as ModerationFlagRowWithBrand[]
  return rows.map(flagToDomain)
}

export type CreateModerationFlagInput = {
  brandId: string
  userId: string
  fieldName: string
  flaggedContent: string
  previousContent: string | null
  flagReason: string
  tier: string
  status: string
}

export async function createModerationFlags(
  records: CreateModerationFlagInput[]
): Promise<ModerationFlag[]> {
  const { createServiceClient } = await import('@/lib/supabase/server')
  const supabase = createServiceClient()

  const insertRows = records.map((r) => ({
    brand_id: r.brandId,
    user_id: r.userId,
    field_name: r.fieldName,
    flagged_content: r.flaggedContent,
    previous_content: r.previousContent,
    flag_reason: r.flagReason,
    tier: r.tier,
    status: r.status,
  }))

  const { data, error } = await supabase
    .from('moderation_flags')
    .insert(insertRows)
    .select('*, brands(name, slug)')

  if (error) throw error

  // Cast to typed join shape — Supabase's select return type doesn't track the brands join
  const resultRows = (data ?? []) as unknown as ModerationFlagRowWithBrand[]
  return resultRows.map(flagToDomain)
}

export async function getModerationFlag(id: string): Promise<ModerationFlag | null> {
  const { createServiceClient } = await import('@/lib/supabase/server')
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('moderation_flags')
    .select('*, brands(name, slug)')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // row not found
    throw error
  }
  if (!data) return null

  // Cast to typed join shape — Supabase's select return type doesn't track the brands join
  return flagToDomain(data as unknown as ModerationFlagRowWithBrand)
}

export async function updateFlagStatus(
  flagId: string,
  decision: 'reviewed' | 'dismissed'
): Promise<void> {
  const { createServiceClient } = await import('@/lib/supabase/server')
  const supabase = createServiceClient()

  const updateData: Record<string, unknown> = {
    status: decision,
  }
  if (decision === 'reviewed') {
    updateData.reviewed_at = new Date().toISOString()
  }

  const { error } = await supabase
    .from('moderation_flags')
    .update(updateData)
    .eq('id', flagId)

  if (error) throw error
}

export function checkContent(
  fields: Record<string, string>
): ModerationResult {
  const blocked: FieldError[] = []
  const flagged: FieldFlag[] = []

  for (const [field, value] of Object.entries(fields)) {
    if (!value) continue

    // Check Tier 1
    for (const rule of TIER1_PATTERNS) {
      if (rule.pattern.test(value)) {
        blocked.push({ field, reason: rule.reason })
        break // One block per field is sufficient
      }
    }

    // Check Tier 2
    flagged.push(...checkTier2(field, value, fields))
  }

  return {
    blocked,
    flagged,
    isBlocked: blocked.length > 0,
  }
}
