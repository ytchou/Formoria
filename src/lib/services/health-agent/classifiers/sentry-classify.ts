/**
 * Sentry issue classifier — uses an LLM to classify a Sentry issue into
 * severity, root cause, confidence, fixability, merge policy, and changed files.
 *
 * Graceful degradation: returns null on any failure so the caller can fall
 * back to the basic heuristic.
 */

import { z } from 'zod'
import type { SentryIssue } from '@/lib/adapters/sentry/issues'
import { fetchLangfusePromptWithMeta } from '@/lib/langfuse/prompt'
import {
  createProfiledOpenAIClient,
  profileChatParams,
} from '@/lib/services/llm-audit'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const SentryClassificationSchema = z
  .object({
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    rootCause: z.string().min(1).max(500),
    confidence: z.number().min(0).max(1),
    fixability: z.enum(['low', 'medium', 'high', 'unknown']),
    mergePolicy: z.enum(['automatic', 'human']),
    changedFiles: z.array(z.string().min(1).max(200)).max(20),
  })
  .strict()

export type SentryClassification = z.infer<typeof SentryClassificationSchema>

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

const MAX_FIELD_LENGTH = 200

/** Patterns that may contain secrets. */
const SECRET_PATTERNS = [
  // JWTs (three dot-separated base64 segments)
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  // Bearer tokens
  /\bBearer\s+\S+/gi,
  // GitHub PATs
  /\bgithub_pat_[A-Za-z0-9_]+\b/g,
  // GitHub fine-grained tokens
  /\bgh[pousr]_[A-Za-z0-9_]+\b/g,
]

function redactSecrets(value: string): string {
  let result = value
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]')
  }
  return result
}

function capString(value: string | undefined, max: number): string | undefined {
  if (!value) return value
  return value.length <= max ? value : value.slice(0, max)
}

/**
 * Build a bounded, secret-free JSON payload from a SentryIssue.
 */
function sanitizeIssue(issue: SentryIssue): string {
  const sanitized = {
    id: issue.id,
    title: capString(redactSecrets(issue.title), MAX_FIELD_LENGTH) ?? '',
    count: issue.count,
    userCount: issue.userCount,
    lastSeen: issue.lastSeen,
    permalink: redactSecrets(issue.permalink),
    level: issue.level,
    ...(issue.culprit
      ? { culprit: capString(redactSecrets(issue.culprit), MAX_FIELD_LENGTH)! }
      : {}),
    ...(issue.firstSeen ? { firstSeen: issue.firstSeen } : {}),
    ...(issue.platform ? { platform: issue.platform } : {}),
    ...(issue.metadata
      ? {
          metadata: {
            ...(issue.metadata.type
              ? { type: capString(redactSecrets(issue.metadata.type), MAX_FIELD_LENGTH)! }
              : {}),
            ...(issue.metadata.value
              ? { value: capString(redactSecrets(issue.metadata.value), MAX_FIELD_LENGTH)! }
              : {}),
          },
        }
      : {}),
  }
  return JSON.stringify(sanitized)
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Dependency injection — testable without mocking @/lib/services/…
// ---------------------------------------------------------------------------

export type SentryClassifyDeps = {
  createClient: typeof createProfiledOpenAIClient
  chatParams: typeof profileChatParams
  fetchPrompt: typeof fetchLangfusePromptWithMeta
}

const defaultDeps: SentryClassifyDeps = {
  createClient: createProfiledOpenAIClient,
  chatParams: profileChatParams,
  fetchPrompt: fetchLangfusePromptWithMeta,
}

/**
 * Classify a Sentry issue using the LLM. Returns null on any failure
 * (graceful degradation).
 *
 * Retries once on schema parse failure.
 */
export async function classifySentryIssue(
  issue: SentryIssue,
  deps: SentryClassifyDeps = defaultDeps,
): Promise<SentryClassification | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const sanitizedJson = sanitizeIssue(issue)

  let text: string
  let prompt: { name: string; version: number; source: 'langfuse' | 'snapshot' }
  try {
    const meta = await deps.fetchPrompt('sentry-classify', {
      issue: sanitizedJson,
    })
    text = meta.text
    prompt = meta.prompt
  } catch {
    return null
  }

  let client: ReturnType<typeof createProfiledOpenAIClient>
  try {
    client = deps.createClient(
      'sentryClassify',
      { phase: 'sentry-classify', prompt },
      { apiKey },
    )
  } catch {
    return null
  }

  // Up to 2 attempts (initial + 1 retry on schema failure)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { content } = await client.chat({
        system: text,
        user: 'Classify this Sentry issue.',
        json: true,
        ...deps.chatParams('sentryClassify'),
      })

      if (!content) continue

      let json: unknown
      try {
        json = JSON.parse(content)
      } catch {
        // JSON parse failure — retry
        continue
      }
      const parsed = SentryClassificationSchema.safeParse(json)
      if (parsed.success) return parsed.data
      // Schema failure — retry
    } catch {
      // LLM transport/API error — no retry
      return null
    }
  }

  return null
}
