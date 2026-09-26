import { describe, expect, it } from 'vitest'

import { acquisitionPlanTask, type AcquisitionPlanTaskDeps } from '../acquisition-plan-replay'
import type { AgentModel } from '../../enrich-phases/agents/runtime'

const MESSAGE = {
  brand: { id: 'b1', slug: 'brand', name: 'Brand' },
  knownUrls: ['https://brand.example'],
  probeResults: [],
  budget: { probes: 4, renders: 0, search: 0, turns: 3, wallClockMs: 30_000 },
}

const PLAN = {
  surfaces: [],
  fanOut: [],
  catalog: { entryUrls: [], priorityProductUrls: [] },
  socialBios: {},
  decisions: [],
}

function deps(overrides: Partial<AcquisitionPlanTaskDeps> = {}) {
  const calls: Array<{ input: unknown; options: unknown }> = []
  const base: AcquisitionPlanTaskDeps = {
    createAgentModel: async () => ({}) as AgentModel,
    runPlanStage: async (input, _deps, options) => {
      calls.push({ input, options })
      return { plan: PLAN }
    },
    fetchHtml: async () => ({ text: '', status: 200 }) as never,
    fetchPromptMeta: async () => ({
      text: 'plan prompt',
      prompt: { name: 'acquisition-plan', version: 2, source: 'langfuse' },
    }),
    parsePromptVersionPins: () => ({}),
    ...overrides,
  }
  return { base, calls }
}

const ARM = { name: 'prompt-v2', type: 'prompt' as const, value: 'acquisition-plan:2' }
const item = { id: 'i1', input: JSON.stringify(MESSAGE), expectedOutput: { context: {} }, humanApproval: {} }

describe('acquisitionPlanTask', () => {
  it('replays the stored message with its recorded budget and returns the plan', async () => {
    const { base, calls } = deps()
    const result = await acquisitionPlanTask(base)(item, ARM, { itemRunId: 'r1' })

    expect(result).toMatchObject({ ok: true, output: PLAN, promptMeta: { version: 2, source: 'langfuse' } })
    expect(calls[0]!.input).toEqual({
      brand: MESSAGE.brand,
      knownUrls: MESSAGE.knownUrls,
      probeResults: MESSAGE.probeResults,
    })
    expect(calls[0]!.options).toMatchObject({ budgetOverride: MESSAGE.budget })
  })

  it('fails the item when a pinned version resolves from the snapshot', async () => {
    const { base, calls } = deps({
      parsePromptVersionPins: () => ({ 'acquisition-plan': 1 }),
      fetchPromptMeta: async () => ({
        text: 'snapshot',
        prompt: { name: 'acquisition-plan', version: 2, source: 'snapshot' },
      }),
    })
    const result = await acquisitionPlanTask(base)(item, ARM, { itemRunId: 'r1' })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('resolved from snapshot')
    expect(calls).toHaveLength(0)
  })
})
