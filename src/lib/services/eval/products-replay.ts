/**
 * Products replay for the eval harness.
 *
 * Rebuilds a `ProductsInput` from a golden dataset item's recorded input,
 * injects frozen page evidence and a dead fetch, and runs the products agent
 * graph identically to production — except no network I/O and no database
 * writes (the model has no `target`).
 */

import type { ProductPageEvidence, ReadPageDeps } from '../enrich-phases/products/read-page'
import type { ProductsInput, ProductsOutput, ProductsDeps } from '../enrich-phases/products/graph'
import type { ProductCandidate } from '../enrich-phases/product-candidates'
import { PRODUCTS_BUDGET_CEILINGS } from '../enrich-phases/products/budget'
import { parsePromptVersionPins } from '@/lib/langfuse/prompt'
import type { AgentModel } from '../enrich-phases/agents/runtime'
import type { LlmAuditContext } from '../llm-audit'
import type { LlmProfileKey } from '@/lib/constants/llm-models'
import type { ExperimentItem, ExperimentArm } from './run-experiment'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DatasetItem = ExperimentItem

type DatasetItemInput = {
  brand: { id: string; slug: string; name: string; url?: string }
  pool: Array<{
    url: string
    normalizedUrl: string
    title?: string
    imageUrl?: string
    supplier: string
    urlClass: string
    searchPosition?: number
  }>
  candidateIdsByUrl: Record<string, string>
  priorityProductUrls: string[]
  evidence: Record<string, ProductPageEvidence>
}

type TaskResult = {
  ok: boolean
  output: unknown
  error?: string
  promptMeta?: { name: string; version: number; source: 'langfuse' | 'snapshot' }
}

// ---------------------------------------------------------------------------
// buildReplayInput
// ---------------------------------------------------------------------------

export function buildReplayInput(itemInput: unknown): ProductsInput {
  const input = itemInput as DatasetItemInput

  const candidateIdsByUrl = new Map<string, string>(
    Object.entries(input.candidateIdsByUrl ?? {}),
  )

  const pool: ProductCandidate[] = input.pool.map((p) => ({
    url: p.url,
    normalizedUrl: p.normalizedUrl,
    title: p.title,
    imageUrl: p.imageUrl,
    supplier: p.supplier,
    urlClass: p.urlClass as ProductCandidate['urlClass'],
    searchPosition: p.searchPosition,
  }))

  return {
    brand: input.brand,
    pool,
    imagePool: [],
    priorityProductUrls: input.priorityProductUrls ?? [],
    candidateIdsByUrl,
  }
}

// ---------------------------------------------------------------------------
// frozenReadPage
// ---------------------------------------------------------------------------

export function frozenReadPage(
  evidenceByUrl: Map<string, ProductPageEvidence>,
): (url: string, deps: ReadPageDeps) => Promise<ProductPageEvidence> {
  return async (url: string, _deps: ReadPageDeps) => {
    const evidence = evidenceByUrl.get(url)
    if (!evidence) {
      throw new Error(`frozenReadPage: no evidence recorded for ${url}`)
    }
    return evidence
  }
}

// ---------------------------------------------------------------------------
// deadFetch
// ---------------------------------------------------------------------------

export const deadFetch = async (_url: string): Promise<{ text: string; statusCode: number }> => ({
  text: '',
  statusCode: 404,
})

// ---------------------------------------------------------------------------
// parsePromptMeta
// ---------------------------------------------------------------------------

function parsePromptMeta(
  decisions: ProductsOutput['decisions'],
): { name: string; version: number; source: 'langfuse' | 'snapshot' } | undefined {
  for (const decision of decisions) {
    if (decision.step !== 'propose' || decision.action !== 'prompt resolved') continue
    const match = decision.reason.match(/prompt=(.+?)@(\d+)\s+source=(\w+)/)
    if (match) {
      return {
        name: match[1]!,
        version: Number(match[2]!),
        source: match[3] as 'langfuse' | 'snapshot',
      }
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// productsTask
// ---------------------------------------------------------------------------

type ProductsTaskDeps = {
  createAgentModel: (
    profileKey: LlmProfileKey,
    audit: LlmAuditContext,
    options: { jsonObject: boolean },
  ) => Promise<AgentModel>
  runProductsAgent: (
    input: ProductsInput,
    deps: ProductsDeps,
    options: { model: AgentModel; budgetOverride: { reads: number; renders: number; turns: number; wallClockMs: number } },
  ) => Promise<ProductsOutput>
}

export function productsTask(taskDeps: ProductsTaskDeps) {
  return async (
    item: DatasetItem,
    _arm: ExperimentArm,
    _ctx: { itemRunId: string; model?: string },
  ): Promise<TaskResult> => {
    const input = item.input as DatasetItemInput
    const replayInput = buildReplayInput(input)

    // Build evidence map from item input
    const evidenceByUrl = new Map<string, ProductPageEvidence>(
      Object.entries(input.evidence ?? {}),
    )

    // Create model with NO target (zero-write path)
    const model = await taskDeps.createAgentModel(
      'products_agent',
      { phase: 'products' },
      { jsonObject: true },
    )

    const graphOutput = await taskDeps.runProductsAgent(
      replayInput,
      {
        readPage: frozenReadPage(evidenceByUrl),
        fetchHtml: deadFetch,
      },
      {
        model,
        budgetOverride: {
          reads: 12,
          renders: 0,
          turns: 6,
          wallClockMs: PRODUCTS_BUDGET_CEILINGS.wallClockMs,
        },
      },
    )

    const promptMeta = parsePromptMeta(graphOutput.decisions)

    // Check pinned prompt source — a pin is meaningless if the SDK
    // couldn't reach Langfuse and fell back to the snapshot.
    const pins = parsePromptVersionPins()
    if (pins['products-propose'] !== undefined && promptMeta?.source !== 'langfuse') {
      return {
        ok: false,
        output: null,
        error: `prompt pin products-propose:${pins['products-propose']} resolved from ${promptMeta?.source ?? 'unknown'}, not langfuse`,
        promptMeta,
      }
    }

    // Fallback or blocked outcomes
    if (graphOutput.agentOutcome === 'fallback' || graphOutput.agentOutcome === 'blocked') {
      return {
        ok: false,
        output: null,
        error: `${graphOutput.agentOutcome}: ${graphOutput.error ?? 'unknown'}`,
        promptMeta,
      }
    }

    // Convert evaluations Map to a plain record for JSON serialization
    // searchPosition comes from the input pool, not the graph evaluations
    const searchPositionByUrl = new Map<string, number | null>(
      replayInput.pool.map((c) => [c.url, c.searchPosition ?? null]),
    )
    const evaluationsRecord: Record<string, { score: number | null; searchPosition: number | null }> = {}
    for (const [url, evaluation] of graphOutput.evaluations) {
      evaluationsRecord[url] = {
        score: (evaluation as { score?: number | null }).score ?? null,
        searchPosition: searchPositionByUrl.get(url) ?? null,
      }
    }

    const selected = graphOutput.proposals.map((p) => p.officialUrl)

    const output = {
      evaluations: evaluationsRecord,
      selected,
      proposals: graphOutput.proposals,
      agentOutcome: graphOutput.agentOutcome,
    }

    return {
      ok: true,
      output,
      promptMeta,
    }
  }
}
