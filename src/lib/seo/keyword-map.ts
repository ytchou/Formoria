import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

/**
 * Keyword ownership registry (DEV-1354).
 *
 * One row per keyword cluster, one owning page per cluster. The registry is a
 * committed YAML file so keyword ownership is reviewable in a PR diff instead of
 * living in a spreadsheet.
 *
 * This module must stay free of Next.js/React imports: it is consumed by
 * `scripts/seo/*` and by tests only, never by the client bundle.
 *
 * Field names stay snake_case to match the YAML source 1:1 — this is a data
 * registry, not a DB row that gets camelCased at a service boundary.
 */

import {
  COMPOSITES,
  DATA_QUALITIES,
  ELIGIBILITIES,
  INDEXABILITIES,
  LOCALES,
  PAGE_TYPES,
  PRIORITIES,
  SEARCH_INTENTS,
  TARGET_STATUSES,
  type PageType,
  type Priority,
} from './keyword-map-constants'

// The enum arrays live in a dependency-free module so pure consumers can import
// a page-type name without pulling `node:fs`/`yaml`/`zod` in. Re-exported here so
// `from './keyword-map'` keeps working for every existing import site.
export * from './keyword-map-constants'

/** Page types whose row must name the ontology slug it is built from. */
const TAXONOMY_PAGE_TYPES = new Set<PageType>(['l1-category', 'l2-category'])

/**
 * Target statuses whose row must name the URL it owns. `pending` rows are
 * research placeholders with no page in view, so they legitimately have none.
 *
 * Scoped to `live` only: every one of the 11 URL-less rows in the committed map
 * is `proposed` (they are the multi-intent clusters that are rejected before a
 * URL is ever chosen), so requiring a URL for `proposed` would fail the real
 * artifact. See the code-review note in the return for DEV-1354.
 */
const URL_REQUIRED_STATUSES = new Set(['live'])

export type PriorityInput = {
  brand_count: number
  intent_fit: number
  differentiation: number
}

/**
 * Priority is DERIVED, never hand-assigned.
 *
 * Rule: score = brandCountBucket + intent_fit + differentiation, where the
 * bucket is 3 (>=20 brands) / 2 (>=10) / 1 (>=5) / 0 (below 5) and the other two
 * inputs are 1..3. Score therefore runs 2..9 and is monotonic in every input.
 *
 *   score >= 9 -> P0   (max on all three: >=20 brands, intent_fit 3, diff 3)
 *   score >= 7 -> P1
 *   score >= 5 -> P2
 *   else       -> P3
 *
 * Because each bucket boundary is one score point wide at the top, dropping any
 * single input from its maximum strictly lowers the priority (9 -> 8 -> P1).
 */
export function derivePriority({
  brand_count,
  intent_fit,
  differentiation,
}: PriorityInput): Priority {
  const bucket = brand_count >= 20 ? 3 : brand_count >= 10 ? 2 : brand_count >= 5 ? 1 : 0
  const score = bucket + intent_fit + differentiation

  if (score >= 9) return 'P0'
  if (score >= 7) return 'P1'
  if (score >= 5) return 'P2'
  return 'P3'
}

const keywordClusterShape = z.object({
  id: z.string().min(1),
  primary_keyword: z.string().min(1),
  secondary_keywords: z.array(z.string().min(1)).default([]),
  search_intent: z.enum(SEARCH_INTENTS),
  page_type: z.enum(PAGE_TYPES),
  target_url: z.string().min(1).optional(),
  target_status: z.enum(TARGET_STATUSES),
  /** Required exactly when page_type is l1-category or l2-category. */
  ontology_slug: z.string().min(1).optional(),
  brand_count: z.number().int().min(0),
  data_quality: z.enum(DATA_QUALITIES),
  intent_fit: z.number().int().min(1).max(3),
  differentiation: z.number().int().min(1).max(3),
  /** Optional in the file; when present it must equal derivePriority(row). */
  priority: z.enum(PRIORITIES).optional(),
  eligibility: z.enum(ELIGIBILITIES),
  composite: z.enum(COMPOSITES).default('none'),
  content_requirement: z.string().min(1),
  indexability: z.enum(INDEXABILITIES),
  locale: z.enum(LOCALES),
  notes: z.string().default(''),
}).strict()

export const keywordClusterSchema = keywordClusterShape.superRefine((row, ctx) => {
  if (TAXONOMY_PAGE_TYPES.has(row.page_type) && !row.ontology_slug) {
    ctx.addIssue({
      code: 'custom',
      path: ['ontology_slug'],
      message: `ontology_slug is required when page_type is "${row.page_type}"`,
    })
  }

  // A multi-intent composite bundles more than one intent behind one page, so it
  // can never be launch-eligible. Structural, not conventional.
  if (row.composite === 'multi-intent' && row.eligibility === 'launch') {
    ctx.addIssue({
      code: 'custom',
      path: ['composite'],
      message:
        'composite "multi-intent" cannot be eligibility "launch" — split the cluster or defer it',
    })
  }

  // A row that names a status implying a real page must name that page. Without
  // this, `target_status: live` with no `target_url` parses clean and the
  // one-owner invariant silently skips the row.
  if (URL_REQUIRED_STATUSES.has(row.target_status) && !row.target_url) {
    ctx.addIssue({
      code: 'custom',
      path: ['target_url'],
      message: `target_url is required when target_status is "${row.target_status}"`,
    })
  }

  if (row.priority) {
    const derived = derivePriority(row)
    if (row.priority !== derived) {
      ctx.addIssue({
        code: 'custom',
        path: ['priority'],
        message: `priority is derived: expected "${derived}" for brand_count=${row.brand_count}, intent_fit=${row.intent_fit}, differentiation=${row.differentiation}, found "${row.priority}"`,
      })
    }
  }
})

const unmappedBacklogRowSchema = z.object({
  slug: z.string().min(1),
  brand_count: z.number().int().min(0),
  composite: z.enum(COMPOSITES).optional(),
  notes: z.string().optional(),
}).strict()

const keywordMapSchema = z.object({
  version: z.union([z.number(), z.string()]).optional(),
  generated_at: z.string().optional(),
  source: z.string().optional(),
  owner: z.string().optional(),
  notes: z.string().optional(),
  clusters: z.array(keywordClusterSchema).default([]),
  unmapped_backlog: z.array(unmappedBacklogRowSchema).default([]),
}).strict()

export type KeywordCluster = z.infer<typeof keywordClusterSchema>
export type KeywordMap = z.infer<typeof keywordMapSchema>

export const DEFAULT_KEYWORD_MAP_PATH = 'content/seo/keyword-map.yaml'

/**
 * Read + validate the keyword map. `path` is resolved against the repo root
 * (process.cwd(), which is the repo root for both `pnpm test` and `tsx`).
 * Any failure — missing file, malformed YAML, schema violation — is rethrown
 * with the file path in the message so a script operator knows which file to fix.
 */
export function loadKeywordMap(path: string = DEFAULT_KEYWORD_MAP_PATH): KeywordMap {
  const absolutePath = isAbsolute(path) ? path : resolve(/* turbopackIgnore: true */ process.cwd(), path)

  let raw: string
  try {
    raw = readFileSync(absolutePath, 'utf8')
  } catch (error) {
    throw new Error(`Failed to read keyword map at ${absolutePath}: ${describeError(error)}`)
  }

  let document: unknown
  try {
    document = parseYaml(raw)
  } catch (error) {
    throw new Error(`Failed to parse YAML in keyword map at ${absolutePath}: ${describeError(error)}`)
  }

  const result = keywordMapSchema.safeParse(document)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid keyword map at ${absolutePath}:\n${issues}`)
  }

  return result.data
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
