import type { PhaseAdapter } from './phase-adapters'
import type { ExperimentDeps } from './run-experiment'
import type { PromptName } from '@/lib/langfuse/prompt'

/**
 * Build the ExperimentDeps object used by script-level experiment runners
 * (llm-eval, search-eval). Consolidates dynamic imports and wiring that was
 * previously inlined in each script's cmdRun.
 */
export async function createScriptExperimentDeps(opts: {
  adapter: PhaseAdapter
  profileKey: string
}): Promise<ExperimentDeps> {
  const { adapter, profileKey } = opts

  const { installSeams, assertNoNewAuditRows } = await import(
    '@/lib/services/eval/zero-write'
  )
  const { fetchLangfusePromptWithMeta } = await import('@/lib/langfuse/prompt')
  const { createProfiledOpenAIClient, profileChatParams } = await import(
    '@/lib/services/llm-audit'
  )
  const { runWithAuditContext, getAuditContext } = await import(
    '@/lib/audit/context'
  )
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { dirname } = await import('node:path')
  const { getLangfuse, flushLangfuse } = await import('@/lib/langfuse/client')

  const callModel: ExperimentDeps['callModel'] = async (input, options, _itemRunId) => {
    const openai = createProfiledOpenAIClient(
      profileKey as Parameters<typeof createProfiledOpenAIClient>[0],
      { phase: input.phase, ...(input.prompt ? { prompt: input.prompt } : {}) },
      { model: options.model },
    )
    const result = await openai.chat({
      system: input.system,
      user: input.user,
      json: true,
      schema: adapter.requestSchema as { name: string; schema: Record<string, unknown> },
      ...profileChatParams(profileKey as Parameters<typeof profileChatParams>[0]),
    })
    return { ok: result.response.ok, content: result.content ?? '' }
  }

  return {
    callModel,
    createTrace: (params: { name: string; id: string; metadata?: unknown }) => {
      const lf = getLangfuse()
      if (!lf) return null
      return lf.trace(params)
    },
    writeFile: (path: string, content: string) => {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content)
    },
    now: () => new Date(),
    flushLangfuse,
    fetchPrompt: (name: string, variables?: Record<string, string>) =>
      fetchLangfusePromptWithMeta(name as PromptName, variables),
    installSeams,
    assertNoNewAuditRows,
    runWithAuditContext,
    getAuditContext,
  }
}
