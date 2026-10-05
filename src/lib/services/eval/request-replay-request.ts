/**
 * Request rebuild and response normalization for `llm-eval replay`
 * (DEV-1917, design D4 + D9).
 *
 * - `toChatInput` turns a logged `brand_ai_results.request` back into the
 *   `ChatInput` production sent.
 * - `rebuildImages` restores the images the logger replaced with
 *   `{omitted:"data-uri"}`. All I/O is injected; the defaults
 *   (`loadVisionDataUri`, `fetchVisionImage`, the Supabase row lookups) are
 *   wired by the orchestrator.
 * - `normalizeStored` / `normalizeFresh` put the stored `raw_response` and a
 *   fresh `OpenAIChatResult` into one `NormalizedResponse` shape for scoring.
 */

import type { EnrichmentTarget } from '../_shared/enrichment-target'
import type { LoggedRequest } from '../llm-audit'
import type { ChatToolCall, createOpenAIClient, OpenAIChatResult } from '../openai-client'
import type { NormalizedResponse } from './request-replay-score'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Exactly what the audited client's `chat` accepts. */
export type ChatInput = Parameters<ReturnType<typeof createOpenAIClient>['chat']>[0]

export type ImageTable = 'brand_images' | 'submission_images'

/** `images` is undefined when the request sends no rebuilt images. */
export type ImageRebuildResult = { images: string[] | undefined } | { skip: 'image' }

/** The slice of a replay span that image rebuild reads; the result is cached on it. */
export type ImageSpan = {
  request: LoggedRequest
  target: EnrichmentTarget
  imageRebuild?: ImageRebuildResult
}

export type ImageRebuildDeps = {
  /** Stored path: image row `id` in `table` → vision data URI (via `loadVisionDataUri`), or null. */
  loadStoredImage: (table: ImageTable, id: string) => Promise<string | null>
  /** Acquire path: the target's image row with this `source_url` → vision data URI from Storage, or null. */
  loadBySourceUrl: (table: ImageTable, targetId: string, sourceUrl: string) => Promise<string | null>
  /** Acquire-path fallback: re-fetch and gate the URL (`image-download.ts` `fetchVisionImage`). */
  fetchVisionImage: (url: string) => Promise<string | null>
}

// ---------------------------------------------------------------------------
// Request → ChatInput
// ---------------------------------------------------------------------------

/** Every `ChatInput` key the logger records (`signal` is never logged). */
const PASS_THROUGH_KEYS = [
  'system',
  'user',
  'messages',
  'tools',
  'json',
  'timeoutMs',
  'maxTokens',
  'temperature',
  'reasoningEffort',
  'images',
  'imageDetail',
  'meta',
  'schema',
] as const satisfies ReadonlyArray<keyof ChatInput>

/**
 * Rebuilds the caller's `ChatInput`. `v` is dropped. `images`, when given,
 * replaces the logged images (which hold `{omitted}` placeholders). With
 * `tools`, `json`/`schema` are dropped: the client sends no response_format
 * alongside tools, so production never sent them either.
 */
export function toChatInput(request: LoggedRequest, images?: string[]): ChatInput {
  const input: Record<string, unknown> = {}
  for (const key of PASS_THROUGH_KEYS) {
    if (request[key] !== undefined) input[key] = request[key]
  }
  if (images !== undefined) input.images = images
  if (input.tools !== undefined) {
    delete input.json
    delete input.schema
  }
  return input as ChatInput
}

// ---------------------------------------------------------------------------
// Image rebuild
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ORDINAL_RE = /^\d+$/
const HTTP_RE = /^https?:\/\//i
const SKIP: ImageRebuildResult = { skip: 'image' }

function isOmitted(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as { omitted?: unknown }).omitted === 'data-uri'
  )
}

function imageUrl(image: unknown): string | null {
  const url = typeof image === 'string' ? image : (image as { url?: unknown } | null)?.url
  return typeof url === 'string' && HTTP_RE.test(url) ? url : null
}

function messagesHaveOmittedPart(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false
  return messages.some(
    (message) =>
      Array.isArray((message as { content?: unknown } | null)?.content) &&
      ((message as { content: unknown[] }).content).some(isOmitted),
  )
}

async function rebuildStored(
  ids: string[],
  table: ImageTable,
  deps: ImageRebuildDeps,
): Promise<ImageRebuildResult> {
  const images: string[] = []
  // Sequential: a step's spans carry a handful of images, and order must hold.
  for (const id of ids) {
    const dataUri = await deps.loadStoredImage(table, id)
    if (!dataUri) return SKIP
    images.push(dataUri)
  }
  return { images }
}

async function rebuildAcquired(
  logged: unknown[],
  table: ImageTable,
  targetId: string,
  deps: ImageRebuildDeps,
): Promise<ImageRebuildResult> {
  const images: string[] = []
  for (const image of logged) {
    const url = imageUrl(image)
    if (!url) return SKIP
    const dataUri = (await deps.loadBySourceUrl(table, targetId, url)) ?? (await deps.fetchVisionImage(url))
    if (!dataUri) return SKIP
    images.push(dataUri)
  }
  return { images }
}

async function computeImageRebuild(span: ImageSpan, deps: ImageRebuildDeps): Promise<ImageRebuildResult> {
  const { request, target } = span
  if (messagesHaveOmittedPart(request.messages)) return SKIP

  const logged = Array.isArray(request.images) ? (request.images as unknown[]) : null
  const rawIds = (request.meta as { imageIds?: unknown } | undefined)?.imageIds
  const ids = Array.isArray(rawIds) ? rawIds.map(String) : []
  const table: ImageTable = target.type === 'submission' ? 'submission_images' : 'brand_images'
  const first = ids[0]

  if (first !== undefined && UUID_RE.test(first)) {
    // Stored path: ids are the authority; a count mismatch means a shifted image.
    if (logged && logged.length !== ids.length) return SKIP
    return rebuildStored(ids, table, deps)
  }
  if (first !== undefined && ORDINAL_RE.test(first)) {
    if (!logged || logged.length !== ids.length) return SKIP
    return rebuildAcquired(logged, table, target.id, deps)
  }

  // No recognised ids: http images are what production sent; a placeholder cannot be rebuilt.
  if (!logged) return { images: undefined }
  if (logged.some(isOmitted)) return SKIP
  return { images: undefined }
}

/**
 * Restores a span's images once; the result is cached on `span.imageRebuild`
 * and returned as-is on later calls, so both arms reuse one load.
 */
export async function rebuildImages(span: ImageSpan, deps: ImageRebuildDeps): Promise<ImageRebuildResult> {
  if (span.imageRebuild) return span.imageRebuild
  const result = await computeImageRebuild(span, deps)
  span.imageRebuild = result
  return result
}

// ---------------------------------------------------------------------------
// Response normalization
// ---------------------------------------------------------------------------

function normalizeContent(content: string | null | undefined): NormalizedResponse {
  const text = (content ?? '').trim()
  try {
    return { kind: 'json', value: JSON.parse(text) as unknown }
  } catch {
    return { kind: 'text', value: text }
  }
}

/** Wire `arguments` string → parsed object; unparseable or non-object stays the raw string. */
function parseWireArgs(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw ?? ''
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    // Falls through to the raw string, mirroring `rawArguments` on the fresh side.
  }
  return raw
}

type WireToolCall = { function?: { name?: unknown; arguments?: unknown } }

/**
 * Stored `brand_ai_results.raw_response` → normalized answer. Reads only
 * `.response.choices[0].message`, so a merged descriptions/facts row's
 * `parsed` and `validationRejections` are ignored.
 */
export function normalizeStored(rawResponse: unknown): NormalizedResponse {
  const message = (
    rawResponse as {
      response?: { choices?: Array<{ message?: { content?: string | null; tool_calls?: unknown } }> } | null
    } | null
  )?.response?.choices?.[0]?.message
  const toolCalls = message?.tool_calls
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    return {
      kind: 'tools',
      calls: (toolCalls as WireToolCall[]).map((call) => ({
        name: typeof call?.function?.name === 'string' ? call.function.name : '',
        args: parseWireArgs(call?.function?.arguments),
      })),
    }
  }
  return normalizeContent(message?.content)
}

/** Fresh `OpenAIChatResult` → normalized answer, the same shape as `normalizeStored`. */
export function normalizeFresh(result: Pick<OpenAIChatResult, 'content' | 'toolCalls'>): NormalizedResponse {
  const toolCalls: ChatToolCall[] | null = result.toolCalls
  if (toolCalls && toolCalls.length > 0) {
    return {
      kind: 'tools',
      calls: toolCalls.map((call) => ({
        name: call.name,
        args: call.rawArguments !== undefined ? call.rawArguments : call.args,
      })),
    }
  }
  return normalizeContent(result.content)
}
