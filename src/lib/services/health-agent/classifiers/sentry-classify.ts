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
  parseAndValidate,
  toStrictJsonSchema,
} from '@/lib/services/_shared/zod-schema'
import {
  createProfiledOpenAIClient,
  profileChatParams,
} from '@/lib/services/llm-audit'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SentryClassificationSchema = z
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

/**
 * Drop string minLength/maxLength from the wire schema. OpenAI strict mode
 * support for them is unverified and no other call site sends them; Zod still
 * enforces both after parsing. maxItems stays (documented as supported).
 */
function stripStringLengths(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripStringLengths)
  if (!node || typeof node !== 'object') return node
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => key !== 'minLength' && key !== 'maxLength')
      .map(([key, value]) => [key, stripStringLengths(value)]),
  )
}

const SENTRY_CLASSIFICATION_JSON_SCHEMA = {
  name: 'sentry_classification',
  schema: stripStringLengths(
    toStrictJsonSchema(SentryClassificationSchema),
  ) as Record<string, unknown>,
}

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
 * Structured Outputs constrain the shape on the wire, so a schema or parse
 * failure is not retried; transport retries live in the OpenAI client.
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
    // The issue JSON travels in the user message, not the system prompt.
    const meta = await deps.fetchPrompt('sentry-classify')
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

  let content: string | null | undefined
  try {
    const result = await client.chat({
      system: text,
      // "JSON" must appear in the messages: the client's json_object
      // fallback is rejected by OpenAI otherwise.
      user: `Classify this Sentry issue and reply with a JSON object:\n${sanitizedJson}`,
      schema: SENTRY_CLASSIFICATION_JSON_SCHEMA,
      ...deps.chatParams('sentryClassify'),
    })
    content = result.content
  } catch {
    // LLM transport/API error
    return null
  }
  if (!content) return null

  const parsed = parseAndValidate(content, SentryClassificationSchema)
  return parsed.success ? parsed.data : null
}
