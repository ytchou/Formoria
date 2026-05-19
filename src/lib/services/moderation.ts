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
