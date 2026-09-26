/**
 * Acquisition-plan replay for the eval harness (DEV-1873).
 *
 * An `acquisition-plan-golden` item's input is the plan user message
 * production sent: `{ brand, knownUrls, probeResults, budget }`. The task runs
 * only the plan stage on those probe results, with the plan's probe tools
 * fetching live, and returns the submitted plan. The model is built with no
 * `target`, so no audit row is persisted.
 */

import type { PromptMeta } from '@/lib/langfuse/prompt'
import type { LlmProfileKey } from '@/lib/constants/llm-models'
import type { AcquisitionBudget, ProbeResult } from '../enrich-phases/acquisition/budget'
import type { AcquisitionDeps, AcquisitionInput, RunOptions } from '../enrich-phases/acquisition/graph'
import type { AcquisitionPlanType } from '../enrich-phases/acquisition/plan'
import type { AgentModel } from '../enrich-phases/agents/runtime'
import type { LlmAuditContext } from '../llm-audit'
import type { ExperimentArm, ExperimentItem } from './run-experiment'

const PLAN_PROMPT = 'acquisition-plan'

type PlanUserMessage = {
  brand: AcquisitionInput['brand']
  knownUrls: string[]
  probeResults: ProbeResult[]
  budget: AcquisitionBudget
}

type TaskResult = {
  ok: boolean
  output: unknown
  error?: string
  promptMeta?: PromptMeta['prompt']
}

export type AcquisitionPlanTaskDeps = {
  createAgentModel: (profileKey: LlmProfileKey, audit: LlmAuditContext) => Promise<AgentModel>
  runPlanStage: (
    input: AcquisitionInput & { probeResults: ProbeResult[] },
    deps: AcquisitionDeps,
    options: RunOptions,
  ) => Promise<{ plan: AcquisitionPlanType | null; error?: string }>
  fetchHtml: AcquisitionDeps['fetchHtml']
  /** Resolves the prompt the plan stage will send, for the pin guard. */
  fetchPromptMeta: (name: typeof PLAN_PROMPT) => Promise<PromptMeta>
  parsePromptVersionPins: () => Record<string, number>
}

/** Parses the stored plan user message. Items store it as the raw string production sent. */
export function parsePlanUserMessage(input: unknown): PlanUserMessage {
  const parsed = (typeof input === 'string' ? JSON.parse(input) : input) as PlanUserMessage
  if (!parsed || typeof parsed !== 'object' || !parsed.brand || !Array.isArray(parsed.probeResults)) {
    throw new Error('acquisition-plan item input is not a plan user message')
  }
  return parsed
}

export function acquisitionPlanTask(taskDeps: AcquisitionPlanTaskDeps) {
  return async (
    item: ExperimentItem,
    _arm: ExperimentArm,
    _ctx: { itemRunId: string; model?: string },
  ): Promise<TaskResult> => {
    const message = parsePlanUserMessage(item.input)

    // A pin is meaningless if the SDK could not reach Langfuse and fell back to
    // the snapshot (same guard as products-replay). The plan stage reads the
    // pin through the same production fetch, so this resolves what it sends.
    const { prompt: promptMeta } = await taskDeps.fetchPromptMeta(PLAN_PROMPT)
    const pins = taskDeps.parsePromptVersionPins()
    if (pins[PLAN_PROMPT] !== undefined && promptMeta.source !== 'langfuse') {
      return {
        ok: false,
        output: null,
        error: `prompt pin ${PLAN_PROMPT}:${pins[PLAN_PROMPT]} resolved from ${promptMeta.source}, not langfuse`,
        promptMeta,
      }
    }

    // No target: the zero-write path.
    const model = await taskDeps.createAgentModel('acquisition', { phase: 'acquire' })

    const { plan } = await taskDeps.runPlanStage(
      { brand: message.brand, knownUrls: message.knownUrls, probeResults: message.probeResults },
      {
        fetchHtml: taskDeps.fetchHtml,
        // The plan stage never scrapes; only execute/recover call this.
        scrapeBrandUrls: async () => {
          throw new Error('scrapeBrandUrls is not available in plan replay')
        },
      },
      // The recorded budget, so the replayed user message equals the stored one
      // byte for byte instead of being re-sized from the probes.
      { model, budgetOverride: message.budget },
    )

    // A missing plan is the prompt's outcome, not a harness failure: the
    // scorers score it 0 rather than the runner retrying it.
    return { ok: true, output: plan, promptMeta }
  }
}
