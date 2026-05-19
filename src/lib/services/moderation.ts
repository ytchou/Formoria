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
]

// Tier 2: content that should be flagged for review
function checkTier2(field: string, value: string): FieldFlag[] {
  const flags: FieldFlag[] = []

  // Excessive URLs (more than 3 http/https links)
  const urlMatches = value.match(/https?:\/\//g)
  if (urlMatches && urlMatches.length > 3) {
    flags.push({
      field,
      content: value,
      reason: 'Excessive URLs detected (more than 3 links)',
      tier: 'flag',
    })
  }

  // All-caps blocks (more than 30 consecutive uppercase characters)
  if (/[A-Z\s]{30,}/.test(value) && value === value.toUpperCase() && value.length > 30) {
    flags.push({
      field,
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
      field,
      content: value,
      reason: 'Contact information detected in content',
      tier: 'flag',
    })
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
  flagReason: string
  tier: string
  status: string
  reviewedAt: string | null
  createdAt: string
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

  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data ?? []).map((row: any) => ({
    id: row.id,
    brandId: row.brand_id,
    brandName: row.brands?.name ?? null,
    brandSlug: row.brands?.slug ?? null,
    userId: row.user_id,
    fieldName: row.field_name,
    flaggedContent: row.flagged_content,
    flagReason: row.flag_reason,
    tier: row.tier,
    status: row.status,
    reviewedAt: row.reviewed_at ?? null,
    createdAt: row.created_at,
  }))
  /* eslint-enable @typescript-eslint/no-explicit-any */
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
    flagged.push(...checkTier2(field, value))
  }

  return {
    blocked,
    flagged,
    isBlocked: blocked.length > 0,
  }
}
