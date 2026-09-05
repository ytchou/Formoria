/**
 * @formoria-script
 * purpose: LLM evaluation harness — dataset validation, golden review, experiment runs, prompt management, pairwise comparison
 * class: operator
 * invoke: pnpm llm-eval
 * target: staging-default
 * safety: writes-on-apply
 * owner: engineering
 * notes: Writes to Langfuse (dataset items, scores, annotation queue items). Zero production DB writes enforced by assertNoNewAuditRows.
 */
import { readFileSync } from 'node:fs'
import { parseArgs as nodeParseArgs } from 'node:util'

import { config as dotenvConfig } from 'dotenv'

import { loadScriptTarget } from '../shared/target'

// @/ imports — available after loadScriptTarget() sets up env
import { getLangfuse, flushLangfuse } from '@/lib/langfuse/client'
import {
  adapterFor,
  registeredDatasets,
} from '@/lib/services/eval/phase-adapters'
import { enqueueDataset, applyVerdicts } from '@/lib/services/eval/golden-review'
import { runExperiment, type ExperimentArm } from '@/lib/services/eval/run-experiment'

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

export type ArmSpec =
  | { kind: 'prompt'; version: number }
  | { kind: 'model'; model: string }

export type ParsedCommand =
  | { command: 'dataset-validate'; allowUnreviewed: boolean }
  | { command: 'dataset-review-enqueue'; dataset: string }
  | { command: 'dataset-review-push'; dataset: string; approvedBy: string }
  | {
      command: 'run'
      dataset: string
      arms: ArmSpec[]
      envFile?: string
      allowUnreviewed: boolean
    }
  | { command: 'prompt-push'; file: string; name: string }
  | {
      command: 'pairwise-run'
      phase: string
      target: string
      sample: number
      arms: ArmSpec[]
      envFile?: string
    }
  | { command: 'pairwise-report'; runName: string }

export function parseArm(spec: string): ArmSpec {
  const colon = spec.indexOf(':')
  if (colon === -1) {
    throw new Error(
      `Malformed arm spec: ${spec} (expected prompt:<version> or model:<name>)`,
    )
  }

  const kind = spec.slice(0, colon)
  const value = spec.slice(colon + 1)

  if (kind === 'prompt') {
    const version = Number(value)
    if (!value || !Number.isFinite(version) || version < 1) {
      throw new Error(`Malformed arm spec: ${spec} (version must be a positive integer)`)
    }
    return { kind: 'prompt', version }
  }

  if (kind === 'model') {
    if (!value) {
      throw new Error(`Malformed arm spec: ${spec} (model name required)`)
    }
    return { kind: 'model', model: value }
  }

  throw new Error(
    `Malformed arm spec: ${spec} (expected prompt:<version> or model:<name>)`,
  )
}

export function parseCliArgs(args: string[]): ParsedCommand {
  const { positionals, values } = nodeParseArgs({
    args,
    allowPositionals: true,
    options: {
      dataset: { type: 'string' },
      arm: { type: 'string', multiple: true },
      'env-file': { type: 'string' },
      'approved-by': { type: 'string' },
      'allow-unreviewed': { type: 'boolean', default: false },
      name: { type: 'string' },
      phase: { type: 'string' },
      target: { type: 'string' },
      sample: { type: 'string' },
    },
  })

  const sub = positionals[0]

  if (sub === 'dataset') {
    const sub2 = positionals[1]
    if (sub2 === 'validate') {
      return {
        command: 'dataset-validate',
        allowUnreviewed: values['allow-unreviewed'] ?? false,
      }
    }
    if (sub2 === 'review') {
      const sub3 = positionals[2]
      if (sub3 === 'enqueue') {
        if (!values.dataset) throw new Error('--dataset is required')
        return {
          command: 'dataset-review-enqueue',
          dataset: values.dataset,
        }
      }
      if (sub3 === 'push') {
        if (!values.dataset) throw new Error('--dataset is required')
        if (!values['approved-by'])
          throw new Error('--approved-by is required')
        return {
          command: 'dataset-review-push',
          dataset: values.dataset,
          approvedBy: values['approved-by'],
        }
      }
    }
  }

  if (sub === 'run') {
    if (!values.dataset) throw new Error('--dataset is required')
    const arms = (values.arm ?? []).map(parseArm)
    return {
      command: 'run',
      dataset: values.dataset,
      arms,
      envFile: values['env-file'],
      allowUnreviewed: values['allow-unreviewed'] ?? false,
    }
  }

  if (sub === 'prompt') {
    const sub2 = positionals[1]
    if (sub2 === 'push') {
      const file = positionals[2]
      if (!file) throw new Error('file argument is required')
      if (!values.name) throw new Error('--name is required')
      return { command: 'prompt-push', file, name: values.name }
    }
  }

  if (sub === 'pairwise') {
    const sub2 = positionals[1]
    if (sub2 === 'run') {
      if (!values.phase) throw new Error('--phase is required')
      if (!values.target) throw new Error('--target is required')
      const sample = values.sample ? Number(values.sample) : 20
      if (!Number.isFinite(sample) || sample < 1)
        throw new Error('--sample must be a positive integer')
      const arms = (values.arm ?? []).map(parseArm)
      return {
        command: 'pairwise-run',
        phase: values.phase,
        target: values.target,
        sample,
        arms,
        envFile: values['env-file'],
      }
    }
    if (sub2 === 'report') {
      const runName = positionals[2]
      if (!runName) throw new Error('run name argument is required')
      return { command: 'pairwise-report', runName }
    }
  }

  throw new Error(
    `Unknown command: ${args.join(' ')}\n` +
      'Usage:\n' +
      '  llm-eval dataset validate [--allow-unreviewed]\n' +
      '  llm-eval dataset review enqueue --dataset <name>\n' +
      '  llm-eval dataset review push --dataset <name> --approved-by <user>\n' +
      '  llm-eval run --dataset <name> --arm <spec> [--arm <spec>] [--env-file <path>] [--allow-unreviewed]\n' +
      '  llm-eval prompt push <file> --name <name>\n' +
      '  llm-eval pairwise run --phase <phase> --target <target> --sample <n> --arm <spec> [--arm <spec>]\n' +
      '  llm-eval pairwise report <runName>',
  )
}

// ---------------------------------------------------------------------------
// Env file helper
// ---------------------------------------------------------------------------

/**
 * Applies a dotenv file with override:false — existing env vars are preserved.
 * Called BEFORE loadScriptTarget so the scratch file's values win over the
 * target's .env.staging defaults.
 */
export function applyEnvFile(
  path: string,
  processEnv: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): void {
  dotenvConfig({ path, override: false, processEnv })
}

// ---------------------------------------------------------------------------
// Prompt push handler
// ---------------------------------------------------------------------------

type PromptPushDeps = {
  promptsCreate: (body: {
    name: string
    prompt: string
    type: string
    labels: string[]
  }) => Promise<{ name: string; version: number }>
  log: (msg: string) => void
}

export async function handlePromptPush({
  file,
  name,
  deps,
}: {
  file: string
  name: string
  deps?: Partial<PromptPushDeps>
}): Promise<void> {
  const text = readFileSync(file, 'utf8')

  const createFn =
    deps?.promptsCreate ??
    (async (body: {
      name: string
      prompt: string
      type: string
      labels: string[]
    }) => {
      const client = getLangfuse()
      if (!client) throw new Error('Langfuse not configured')
      return client.api.promptsCreate(body as Parameters<typeof client.api.promptsCreate>[0])
    })

  const logFn = deps?.log ?? console.log

  const result = await createFn({ name, prompt: text, type: 'text', labels: [] })
  logFn(`${result.name} v${result.version}`)
}

// ---------------------------------------------------------------------------
// Pre-scan for --env-file (needed before loadScriptTarget)
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
// Subcommand handlers
// ---------------------------------------------------------------------------

async function cmdDatasetValidate(allowUnreviewed: boolean): Promise<void> {
  const client = getLangfuse()
  if (!client) {
    console.error('[validate] Langfuse not configured')
    process.exitCode = 1
    return
  }

  const names = registeredDatasets().filter(
    (name) => adapterFor(name).mode !== 'pairwise',
  )

  let hasUnreviewed = false

  console.log('Dataset                             | Reviewed | Unreviewed | Archived')
  console.log('------------------------------------|----------|------------|--------')

  for (const name of names) {
    const { items } = await client.getDataset(name)
    const active = items.filter((i) => i.status === 'ACTIVE')
    const archived = items.filter((i) => i.status === 'ARCHIVED')
    const reviewed = active.filter(
      (i) =>
        (i.metadata as Record<string, unknown> | undefined)?.humanApproval !==
        undefined,
    )
    const unreviewed = active.length - reviewed.length

    if (unreviewed > 0) hasUnreviewed = true

    console.log(
      `${name.padEnd(36)}| ${String(reviewed.length).padEnd(9)}| ${String(unreviewed).padEnd(11)}| ${archived.length}`,
    )
  }

  await flushLangfuse()

  if (hasUnreviewed && !allowUnreviewed) {
    console.error('[validate] Unreviewed items found. Pass --allow-unreviewed to proceed.')
    process.exitCode = 1
  }
}

async function cmdDatasetReviewEnqueue(dataset: string): Promise<void> {
  const result = await enqueueDataset({ dataset, queueName: dataset })
  console.log(`[enqueue] ${result.enqueued} items enqueued to queue "${result.queueName}"`)
  await flushLangfuse()
}

async function cmdDatasetReviewPush(
  dataset: string,
  approvedBy: string,
): Promise<void> {
  const result = await applyVerdicts({ dataset, queueName: dataset, approvedBy })
  console.log(
    `[push] processed=${result.processed} pending=${result.pending} ` +
      `(approved=${result.summary.approved} edited=${result.summary.edited} rejected=${result.summary.rejected})`,
  )
  await flushLangfuse()
}

async function cmdRun(
  dataset: string,
  armSpecs: ArmSpec[],
  allowUnreviewed: boolean,
): Promise<void> {
  const adapter = adapterFor(dataset)

  const client = getLangfuse()
  if (!client) {
    console.error('[run] Langfuse not configured')
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
        reviewedVia?: string
        at?: string
      } ?? {},
    }))

  const arms: ExperimentArm[] = armSpecs.map((spec) => {
    if (spec.kind === 'prompt') {
      return {
        name: `prompt-v${spec.version}`,
        type: 'prompt' as const,
        value: `${adapter.promptName}:${spec.version}`,
      }
    }
    return { name: spec.model, type: 'model' as const, value: spec.model }
  })

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

  const callModel = async (
    input: { system: string; user: string; phase: string; prompt?: { name: string; version: number } | null },
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
    arms,
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
      fetchPrompt: fetchLangfusePromptWithMeta,
      installSeams,
      assertNoNewAuditRows,
      runWithAuditContext,
      getAuditContext,
    },
  })

  console.log(result.markdown)
  if (result.provisional) {
    console.log('\n(provisional — unreviewed items included)')
  }
  console.log(
    `\nSummary: ${result.summary.succeeded}/${result.summary.total} succeeded`,
  )
  process.exitCode = result.exitCode
}

async function cmdPairwiseRun(
  phase: string,
  _target: string,
  sample: number,
  armSpecs: ArmSpec[],
): Promise<void> {
  const { findQueueByName } = await import('@/lib/services/eval/langfuse-runs')

  const queueId = await findQueueByName({ name: 'pairwise' })
  console.log(`Pairwise queue: ${queueId}`)
  console.log(
    `Phase: ${phase}, sample: ${sample}, arms: ${armSpecs.map((a) => `${a.kind}:${a.kind === 'prompt' ? a.version : a.model}`).join(', ')}`,
  )
  console.log(`Queue found: ${queueId}. Enqueue ${sample} items after running both arms.`)
  await flushLangfuse()
}

async function cmdPairwiseReport(runName: string): Promise<void> {
  const { readFileSync } = await import('node:fs')
  const { pairwiseReport } = await import('@/lib/services/eval/pairwise')
  const { listQueueScores } = await import('@/lib/services/eval/langfuse-runs')

  const runJsonPath = `scripts/llm-eval/runs/${runName}.json`
  const runJson = JSON.parse(readFileSync(runJsonPath, 'utf8'))

  const scores = await listQueueScores({ name: 'preference' })
  const result = pairwiseReport({ runJson, scores })

  console.log(`Win rate: A=${result.aWins} (${(result.aWinRate * 100).toFixed(1)}%), B=${result.bWins} (${(result.bWinRate * 100).toFixed(1)}%), Tie=${result.ties}, Pending=${result.pending}`)
}

async function cmdPromptPush(file: string, name: string): Promise<void> {
  await handlePromptPush({ file, name })
  await flushLangfuse()
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
    applyEnvFile(envFile)
  }

  const { argv: remainingArgv } = loadScriptTarget()
  const parsed = parseCliArgs(remainingArgv)

  switch (parsed.command) {
    case 'dataset-validate':
      await cmdDatasetValidate(parsed.allowUnreviewed)
      break
    case 'dataset-review-enqueue':
      await cmdDatasetReviewEnqueue(parsed.dataset)
      break
    case 'dataset-review-push':
      await cmdDatasetReviewPush(parsed.dataset, parsed.approvedBy)
      break
    case 'run':
      await cmdRun(parsed.dataset, parsed.arms, parsed.allowUnreviewed)
      break
    case 'prompt-push':
      await cmdPromptPush(parsed.file, parsed.name)
      break
    case 'pairwise-run':
      await cmdPairwiseRun(parsed.phase, parsed.target, parsed.sample, parsed.arms)
      break
    case 'pairwise-report':
      await cmdPairwiseReport(parsed.runName)
      break
  }
}

// Guard: only run when executed as a script, not when imported for testing.
// Vitest sets VITEST=true — checking it avoids main() firing during test imports.
if (!process.env.VITEST) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
