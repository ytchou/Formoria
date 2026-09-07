/**
 * @formoria-script
 * purpose: Compare baseline (gpt-5.6-luna) vs mini (gpt-4o-mini) on the DEV-1644 pilot cohort
 * class: operator
 * invoke: npx tsx scripts/experiments/mini-model-trial.ts [--env-file <path>] [--allow-unreviewed] [--dataset <name>]
 * target: staging-default
 * safety: writes-on-apply
 * owner: engineering
 * notes: Uses the shared experiment harness from run-experiment.ts. Zero production DB writes enforced by assertNoNewAuditRows.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { config as dotenvConfig } from 'dotenv'

import { loadScriptTarget } from '../shared/target'

// @/ imports — available after loadScriptTarget() sets up env
import { getLangfuse, flushLangfuse } from '@/lib/langfuse/client'
import { LLM_MODELS } from '@/lib/constants/llm-models'
import { adapterFor } from '@/lib/services/eval/phase-adapters'
import { runExperiment, type ExperimentArm } from '@/lib/services/eval/run-experiment'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PILOT_COHORT_PATH = join(
  process.cwd(),
  'scripts/curation-cohorts/dev-1644-routing-pilot.json',
)

const BASELINE_MODEL = 'gpt-5.6-luna'
const MINI_MODEL = LLM_MODELS.text_mini

const ARMS: ExperimentArm[] = [
  { name: 'baseline', type: 'model', value: BASELINE_MODEL },
  { name: 'mini', type: 'model', value: MINI_MODEL },
]

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function extractEnvFile(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env-file' && i + 1 < args.length) return args[i + 1]
    if (args[i]?.startsWith('--env-file='))
      return args[i]!.slice('--env-file='.length)
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const rawArgs = process.argv.slice(2)

  // Apply --env-file BEFORE loadScriptTarget so the scratch file's values
  // take precedence (loadScriptTarget also uses override: false).
  const envFile = extractEnvFile(rawArgs)
  if (envFile) {
    dotenvConfig({ path: envFile, override: false })
  }

  const { argv } = loadScriptTarget()

  const { values } = parseArgs({
    args: argv,
    options: {
      dataset: { type: 'string', default: 'detect-confidence-golden' },
      'allow-unreviewed': { type: 'boolean', default: false },
      'env-file': { type: 'string' },
    },
  })

  const dataset = values.dataset!
  const allowUnreviewed = values['allow-unreviewed'] ?? false

  // Load pilot cohort for logging context only — the actual items come from
  // the Langfuse dataset, not the cohort file.
  const cohort = JSON.parse(readFileSync(PILOT_COHORT_PATH, 'utf8'))
  console.log(
    `Pilot cohort: ${cohort.name} (${Object.keys(cohort.labels).length} brands)`,
  )
  console.log(`Dataset: ${dataset}`)
  console.log(`Arms: ${ARMS.map((a) => `${a.name}=${a.value}`).join(', ')}`)

  const adapter = adapterFor(dataset)

  const client = getLangfuse()
  if (!client) {
    console.error('[mini-model-trial] Langfuse not configured')
    process.exitCode = 1
    return
  }

  const { items: rawItems } = await client.getDataset(dataset)

  const items = rawItems
    .filter((i) => i.status === 'ACTIVE')
    .map((i) => ({
      id: i.id,
      input: i.input,
      expectedOutput: i.expectedOutput,
      humanApproval: (i.metadata as Record<string, unknown>)?.humanApproval as {
        reviewedVia?: { queueId: string; scoreId: string } | string | undefined
        at?: string
      } ?? {},
    }))

  console.log(`Items: ${items.length} active`)

  const { installSeams, assertNoNewAuditRows } = await import(
    '@/lib/services/eval/zero-write'
  )
  const { fetchLangfusePromptWithMeta } = await import('@/lib/langfuse/prompt')
  type PromptName = import('@/lib/langfuse/prompt').PromptName
  const { createProfiledOpenAIClient, profileChatParams } = await import(
    '@/lib/services/llm-audit'
  )
  const { runWithAuditContext, getAuditContext } = await import(
    '@/lib/audit/context'
  )
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { dirname } = await import('node:path')

  const callModel = async (
    input: { system: string; user: string; phase: string; prompt?: { name: string; version: number; source: 'langfuse' | 'snapshot' } | null },
    options: { model?: string },
    _itemRunId: string,
  ) => {
    const openai = createProfiledOpenAIClient(
      adapter.profileKey as Parameters<typeof createProfiledOpenAIClient>[0],
      { phase: input.phase, ...(input.prompt ? { prompt: input.prompt } : {}) },
      { model: options.model },
    )
    const result = await openai.chat({
      system: input.system,
      user: input.user,
      json: true,
      schema: adapter.requestSchema as { name: string; schema: Record<string, unknown> },
      ...profileChatParams(adapter.profileKey as Parameters<typeof profileChatParams>[0]),
    })
    return { ok: result.response.ok, content: result.content ?? '' }
  }

  const result = await runExperiment({
    dataset,
    arms: ARMS,
    adapter,
    items,
    allowUnreviewed,
    deps: {
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
    },
  })

  console.log('\n' + result.markdown)
  if (result.provisional) {
    console.log('\n(provisional — unreviewed items included)')
  }
  console.log(
    `\nSummary: ${result.summary.succeeded}/${result.summary.total} succeeded`,
  )
  process.exitCode = result.exitCode
}

if (!process.env.VITEST) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
