export const SUSPICIOUS_TLDS = ['.tk', '.ml', '.ga', '.cf', '.gq']
export const MAX_URLS_IN_TEXT = 3
export const MAX_EMOJI_COUNT = 10
export const MIN_CJK_DESCRIPTION_CHARS = 10
export const TRUSTED_OWNER_THRESHOLD = 3
export const ENGLISH_SPAM_PHRASES = ['click here', 'buy now', 'free offer', 'limited time', 'act now']

export type ModerationTier = 'tier1' | 'tier2'
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

const URL_REGEX = /https?:\/\/[^\s]+/gi
const TAIWAN_PHONE_REGEX = /09\d{2}[-.]?\d{3}[-.]?\d{3}/
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
const EMOJI_REGEX = /\p{Emoji_Presentation}/gu
const CJK_REGEX = /[一-鿿]/g

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

export function checkSuspiciousTlds(fields: Record<string, string | undefined>): ModerationFlag[] {
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
              'tier1',
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

export function checkExcessiveUrls(fields: Record<string, string | undefined>): ModerationFlag[] {
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
          'tier1',
          `Too many URLs detected: ${urls.length}`,
          value
        )
      )
    }
  }

  return flags
}

export function checkEnglishSpam(fields: Record<string, string | undefined>): ModerationFlag[] {
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
          'tier1',
          `English spam phrase detected: ${spamPhrase}`,
          value
        )
      )
    }
  }

  return flags
}

export function checkContactInjection(fields: Record<string, string | undefined>): ModerationFlag[] {
  const flags: ModerationFlag[] = []

  for (const fieldName of ['description', 'brandHighlights']) {
    const value = fields[fieldName]

    if (!value) {
      continue
    }

    if (TAIWAN_PHONE_REGEX.test(value)) {
      flags.push(
        createFlag(
          fieldName,
          'tier2',
          'Taiwan phone number detected',
          value
        )
      )
    }

    if (EMAIL_REGEX.test(value)) {
      flags.push(
        createFlag(
          fieldName,
          'tier2',
          'Email address detected',
          value
        )
      )
    }
  }

  return flags
}

export function checkExcessiveEmoji(fields: Record<string, string | undefined>): ModerationFlag[] {
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
          'tier2',
          `Too many emoji detected: ${emojiCount}`,
          value
        )
      )
    }
  }

  return flags
}

export function checkShortOrIdenticalDescription(
  fields: Record<string, string | undefined>,
  brandName: string
): ModerationFlag[] {
  const description = fields.description

  if (!description) {
    return []
  }

  const flags: ModerationFlag[] = []
  const cjkCount = description.match(CJK_REGEX)?.length ?? 0

  if (cjkCount < MIN_CJK_DESCRIPTION_CHARS) {
    flags.push(
      createFlag(
        'description',
        'tier2',
        `Description has fewer than ${MIN_CJK_DESCRIPTION_CHARS} CJK characters`,
        description
      )
    )
  }

  if (description.trim() === brandName.trim()) {
    flags.push(
      createFlag(
        'description',
        'tier2',
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

export async function shouldAutoApprove(_result: ModerationResult, _userId: string): Promise<boolean> {
  return false
}
