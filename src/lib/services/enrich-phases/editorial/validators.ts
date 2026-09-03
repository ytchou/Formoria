/**
 * Editorial cross-output validators, the one repair turn, and the evidence tool.
 *
 * Before this module the editorial agent's production dependencies were
 * `validateCrossOutput: () => []` and `repairCrossOutput: async (p) => p`
 * (DEV-1644 F11): the graph's validate → repair edge existed but could never
 * fire, `EDITORIAL_REPAIR_SYSTEM_PROMPT` had no importer, `LLM_PROFILES.editorial`
 * was never resolved, and `requestEvidence` was never supplied.
 *
 * Two rules shape what is here:
 *
 * 1. **Nothing is re-implemented.** The checks are the same functions the
 *    phases themselves use — `validateLocalizedText` and `detectAiArtifacts`
 *    from `enrich-validators`, the length bands from `description-rewrite`, the
 *    city closed set from `taiwan-cities`, the preset ids from `faq-presets`.
 *    A second copy would drift, and the drift would be invisible.
 * 2. **The repair edits the descriptions patch only.** The stockists and FAQ
 *    nodes already upserted their rows into `brand_channels` and
 *    `brand_faq_entries` before `validate` ran, so a repair that rewrote them
 *    would leave the rows and the patch describing different content
 *    (tweakable #2). Cross-output therefore re-checks exactly what a
 *    description rewrite can break.
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'
import { fetchLangfusePrompt } from '@/lib/langfuse/prompt'
import { EDITORIAL_REPAIR_SYSTEM_PROMPT } from '@/lib/prompts/editorial-agent'
import { CITY_SLUGS } from '@/lib/constants/taiwan-cities'
import { FAQ_PRESETS } from '@/lib/brands/faq-presets'
import type { PhaseResult } from '@/lib/types/curation'
import type { LlmProfileKey } from '@/lib/constants/llm-models'
import { detectAiArtifacts, validateLocalizedText } from '../../enrich-validators'
import {
  EN_BLURB_BAND,
  EN_DESCRIPTION_BAND,
  ZH_BLURB_BAND,
  ZH_DESCRIPTION_BAND,
} from '../../description-rewrite'
import type { LanguageLocale, LengthBand } from '../../eval/scorers'
import { parseAndValidate } from '../../_shared/zod-schema'
import { brandTarget, type EnrichmentTarget } from '../../_shared/enrichment-target'
import { loadPersistedScrapeStructure } from '../descriptions'
import {
  callModel,
  contentText,
  createAgentModel,
  extractJson,
  withSchema,
  type AgentAuditContext,
  type AgentModel,
} from '../agents/runtime'
import type { CrossOutputFailure, EditorialDeps } from './graph'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The repair turn's model profile. `LLM_PROFILES.editorial` exists for this. */
export const EDITORIAL_REPAIR_PROFILE: LlmProfileKey = 'editorial'

/**
 * Audit phase for the repair turn. `'descriptions'` rather than a new value
 * because the turn only ever edits description fields, and because
 * `brand_ai_results.phase` is a CHECK constraint — a new name would need a
 * migration to buy nothing.
 */
export const EDITORIAL_REPAIR_AUDIT_PHASE = 'descriptions'

/** Upper bound on an evidence chunk handed to the repair prompt. */
const MAX_EVIDENCE_CHARS = 1_500

/** Characters of run-up kept before the match, so the hit reads in context. */
const EVIDENCE_LEAD_CHARS = 300

type CopyField = {
  key: string
  locale: LanguageLocale
  band: LengthBand
}

/**
 * The four copy fields `runDescriptionsPhase` writes, with the locale and band
 * each was generated against. The patch keys are `description` / `blurb` for
 * zh-TW — the `_zh` suffix exists only inside the rewrite model's own schema.
 */
const COPY_FIELDS: readonly CopyField[] = [
  { key: 'description', locale: 'zh', band: ZH_DESCRIPTION_BAND },
  { key: 'description_en', locale: 'en', band: EN_DESCRIPTION_BAND },
  { key: 'blurb', locale: 'zh', band: ZH_BLURB_BAND },
  { key: 'blurb_en', locale: 'en', band: EN_BLURB_BAND },
]

const REPAIRABLE_FIELDS = new Set(COPY_FIELDS.map((field) => field.key))

const CITY_SLUG_SET = new Set<string>(CITY_SLUGS)

const FAQ_PRESET_IDS = new Set(FAQ_PRESETS.map((preset) => preset.id))

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type EditorialValidationContext = {
  /**
   * Exempted from the Latin-word-run check inside `validateLocalizedText`: a
   * brand cannot be described without being named, and a name like
   * "Seal F Bikini" is itself a long Latin run.
   */
  brandName?: string | null
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/** Which phase owns a field, so a failed phase's fields are not reported. */
function ownerPhase(field: string): string {
  return field.startsWith('faq_entries') ? 'faq' : 'descriptions'
}

/**
 * The checks themselves, with no phase gating. Shared by the public validator
 * and by the post-repair re-check, so "the repaired field passes" is decided by
 * the same code that rejected it.
 */
function validateFields(
  patch: Record<string, unknown>,
  ctx: EditorialValidationContext,
): CrossOutputFailure[] {
  const failures: CrossOutputFailure[] = []

  for (const field of COPY_FIELDS) {
    const text = textValue(patch[field.key])
    if (!text) continue

    const validation = validateLocalizedText(text, field.locale, field.band, ctx.brandName)
    for (const reason of validation.reasons) {
      failures.push({ field: field.key, reason })
    }
    for (const artifact of detectAiArtifacts(text, field.locale)) {
      failures.push({ field: field.key, reason: artifact })
    }
  }

  const city = textValue(patch.city)
  if (city && !CITY_SLUG_SET.has(city)) {
    failures.push({ field: 'city', reason: `city_not_in_closed_set:${city}` })
  }

  // Dormant unless a future descriptions rewrite carries FAQ rows in the patch:
  // today the FAQ phase upserts its rows and returns an empty patch. The check
  // is here so a preset id that reaches the patch cannot bypass the eligible
  // set, which `validateFaqEntries` enforces inside the phase.
  const faqEntries = patch.faq_entries ?? patch.faqEntries
  if (Array.isArray(faqEntries)) {
    faqEntries.forEach((entry, index) => {
      if (typeof entry !== 'object' || entry === null) return
      const row = entry as Record<string, unknown>
      const presetId = textValue(row.preset_id) ?? textValue(row.presetId)
      if (presetId && !FAQ_PRESET_IDS.has(presetId)) {
        failures.push({
          field: `faq_entries[${index}]`,
          reason: `faq_preset_not_eligible:${presetId}`,
        })
      }
    })
  }

  return failures
}

/**
 * Cross-output validation over the combined patch. Code only — no model call.
 *
 * A phase that FAILED contributes no failures: its fields either never landed
 * or are carry-over the agent cannot be asked to repair, and reporting them
 * would spend the one repair turn on content this run did not produce.
 */
export function validateEditorialCrossOutput(
  patch: Record<string, unknown>,
  phaseResults: PhaseResult[],
  ctx: EditorialValidationContext = {},
): CrossOutputFailure[] {
  const failedPhases = new Set(
    phaseResults.filter((result) => result.status === 'failed').map((result) => result.phase),
  )

  return validateFields(patch, ctx).filter(
    (failure) => !failedPhases.has(ownerPhase(failure.field)),
  )
}

// ---------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------

/**
 * All four fields are present and nullable rather than optional: OpenAI's strict
 * schema mode requires a fully populated `required` array, and `null` is how the
 * model says "I did not change this one".
 */
const EditorialRepairSchema = z.object({
  description: z.string().nullable(),
  description_en: z.string().nullable(),
  blurb: z.string().nullable(),
  blurb_en: z.string().nullable(),
})

export type EditorialRepairParams = {
  patch: Record<string, unknown>
  failures: CrossOutputFailure[]
  /** Bounded excerpt of persisted scrape text, from `createRequestEvidence`. */
  evidence?: string
  model: AgentModel
  audit: Omit<AgentAuditContext, 'phase'>
  signal?: AbortSignal
  validation?: EditorialValidationContext
}

/**
 * ONE audited model turn that rewrites only the failing description fields.
 *
 * The reply is re-run through the same validators, and a field that still fails
 * is dropped — the original text is better than a repair that traded one
 * artifact for another. Returns only the fields that now pass, so the caller
 * merges a patch it has already verified.
 */
export async function repairEditorialCrossOutput(
  params: EditorialRepairParams,
): Promise<Record<string, unknown>> {
  const { patch, failures, evidence, model, audit, signal } = params
  const validation = params.validation ?? {}

  const targets = [
    ...new Set(failures.map((failure) => failure.field).filter((field) => REPAIRABLE_FIELDS.has(field))),
  ]
  if (targets.length === 0) return {}

  const system = withSchema(
    await fetchLangfusePrompt('editorial-repair', EDITORIAL_REPAIR_SYSTEM_PROMPT),
    'EditorialRepair',
    EditorialRepairSchema,
  )

  const user = JSON.stringify({
    brandName: validation.brandName ?? null,
    fieldsToFix: targets,
    currentValues: Object.fromEntries(targets.map((field) => [field, patch[field] ?? null])),
    failures: failures.filter((failure) => targets.includes(failure.field)),
    ...(evidence ? { evidence } : {}),
  })

  const response = await callModel(model, [new SystemMessage(system), new HumanMessage(user)], {
    ...audit,
    phase: EDITORIAL_REPAIR_AUDIT_PHASE,
    ...(signal ? { signal } : {}),
  })

  // The prompt asks for all four keys (strict mode needs a full `required`), but
  // parsing accepts a subset: a model that answers only the field it fixed has
  // still answered, and throwing that away would spend the one repair turn for
  // nothing. Derived from the same schema, so the two cannot drift.
  const parsed = parseAndValidate(
    extractJson(contentText(response)),
    EditorialRepairSchema.partial(),
  )
  if (!parsed.success) return {}

  const proposed: Record<string, string> = {}
  for (const field of targets) {
    const value = textValue((parsed.data as Record<string, unknown>)[field])
    if (value) proposed[field] = value
  }
  if (Object.keys(proposed).length === 0) return {}

  const stillFailing = new Set(
    validateFields({ ...patch, ...proposed }, validation).map((failure) => failure.field),
  )

  return Object.fromEntries(
    Object.entries(proposed).filter(([field]) => !stillFailing.has(field)),
  )
}

// ---------------------------------------------------------------------------
// Evidence tool
// ---------------------------------------------------------------------------

export type RequestEvidenceParams = {
  brandId?: string
  target?: EnrichmentTarget
  supabase?: Parameters<typeof loadPersistedScrapeStructure>[1]
  /** Injection seam: the persisted-pack reader. Defaults to the real one. */
  loadStructure?: typeof loadPersistedScrapeStructure
}

function normalizeUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '')
}

function windowAround(text: string, query: string): string {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return text.slice(0, MAX_EVIDENCE_CHARS)

  const index = text.toLowerCase().indexOf(trimmedQuery.toLowerCase())
  if (index < 0) return ''

  const start = Math.max(0, index - EVIDENCE_LEAD_CHARS)
  return text.slice(start, start + MAX_EVIDENCE_CHARS)
}

/**
 * The agent's `request_evidence` tool: a bounded window of the persisted scrape
 * text for one page, around the first case-insensitive hit for `query`.
 *
 * Returns `''` — never invented text — when the page is unknown, the pack is
 * empty, or the query does not appear. A blank `pageUrl` searches every
 * persisted page, which is what the repair turn uses: it knows the brand but not
 * which page carries the fact it needs.
 *
 * The pack is read once per instance: a repair turn may ask several times, and
 * each ask would otherwise be another round trip for the same rows.
 */
export function createRequestEvidence(
  params: RequestEvidenceParams,
): (pageUrl: string, query: string) => Promise<string> {
  const load = params.loadStructure ?? loadPersistedScrapeStructure
  const target = params.target ?? (params.brandId ? brandTarget(params.brandId) : null)

  let packPromise: ReturnType<typeof load> | null = null

  return async (pageUrl: string, query: string): Promise<string> => {
    if (!target) return ''

    try {
      packPromise ??= load(target, params.supabase)
      const pack = await packPromise

      const pages = Object.entries(pack)
      const wanted = normalizeUrl(pageUrl ?? '')
      const selected = wanted
        ? pages.filter(([url]) => normalizeUrl(url) === wanted)
        : pages

      for (const [, page] of selected) {
        const text = [page.title, page.description, page.story]
          .filter((part): part is string => Boolean(part))
          .join('\n')
        if (!text) continue

        const chunk = windowAround(text, query)
        if (chunk) return chunk
      }

      return ''
    } catch {
      // Evidence is an aid, never a precondition: a failed read must not turn
      // into a failed repair, and a fabricated chunk would be worse than none.
      return ''
    }
  }
}

// ---------------------------------------------------------------------------
// Dependency assembly
// ---------------------------------------------------------------------------

export type BuildEditorialDepsParams = {
  runDescriptions: EditorialDeps['runDescriptions']
  runStockists: EditorialDeps['runStockists']
  runFaq: EditorialDeps['runFaq']
  /** Attribution for the repair turn. `phase` is forced to `'descriptions'`. */
  audit: Omit<AgentAuditContext, 'phase'>
  brandName?: string | null
  /** Pre-built model. Absent, one is created from `LLM_PROFILES.editorial`. */
  model?: AgentModel
  createModel?: (profile: LlmProfileKey) => Promise<AgentModel>
  supabase?: RequestEvidenceParams['supabase']
  signal?: AbortSignal
  /** Override for tests; otherwise built from the audit target. */
  requestEvidence?: EditorialDeps['requestEvidence']
}

/**
 * Builds the full `EditorialDeps` with the real validators, the real repair turn
 * and the real evidence tool wired in. This is what the orchestrator calls; the
 * graph itself stays dependency-free.
 */
export function buildEditorialDeps(params: BuildEditorialDepsParams): EditorialDeps {
  const validation: EditorialValidationContext = { brandName: params.brandName ?? null }
  const createModel = params.createModel ?? createAgentModel
  const target = params.audit.target

  const requestEvidence =
    params.requestEvidence ??
    (target
      ? createRequestEvidence({ target, supabase: params.supabase })
      : undefined)

  let modelPromise: Promise<AgentModel> | null = null
  const resolveModel = (): Promise<AgentModel> => {
    modelPromise ??= params.model
      ? Promise.resolve(params.model)
      : createModel(EDITORIAL_REPAIR_PROFILE)
    return modelPromise
  }

  return {
    runDescriptions: params.runDescriptions,
    runStockists: params.runStockists,
    runFaq: params.runFaq,
    validateCrossOutput: (patch, phaseResults) =>
      validateEditorialCrossOutput(patch, phaseResults, validation),
    async repairCrossOutput(patch, failures) {
      try {
        const evidence = requestEvidence
          ? await requestEvidence('', params.brandName ?? '')
          : ''

        return await repairEditorialCrossOutput({
          patch,
          failures,
          ...(evidence ? { evidence } : {}),
          model: await resolveModel(),
          audit: params.audit,
          ...(params.signal ? { signal: params.signal } : {}),
          validation,
        })
      } catch {
        // A failed repair leaves the generated copy in place. The turn's own
        // audit row (written by `callModel` on failure too) carries the reason;
        // throwing here would drop the whole editorial output to `fallback`.
        return {}
      }
    },
    ...(requestEvidence ? { requestEvidence } : {}),
  }
}
