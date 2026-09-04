/**
 * @formoria-script
 * purpose: Runs the curation pipeline (detect, enrich, reputation) over brands or submissions from the CLI.
 * class: operator
 * invoke: pnpm curate
 * target: staging-default
 * safety: writes-on-apply
 * owner: engineering
 */
import { flushLangfuse } from '@/lib/langfuse/client'
import { createServiceClient } from '@/lib/supabase/service'
import {
  CURATION_TASK_ORDER,
  ENRICH_PHASES,
  normalizeRequestedPhases,
  phasesForTask,
  type CurationTask,
} from '@/lib/constants/enrich-phases'
import {
  type CurationConfig,
  type OperationResult,
  runEnrich,
} from '@/lib/services/curation-operations'
import { requestBrandRefreshesBySlugs } from '@/lib/services/submissions'
import type { BrandStatus } from '@/lib/types'
import { loadScriptTarget } from './shared/target'

const COMMANDS = ['enrich'] as const

type CurationCommand = (typeof COMMANDS)[number]
type EnrichPhase = (typeof ENRICH_PHASES)[number]
type ParsedCurationConfig = CurationConfig & {
  phases?: EnrichPhase[]
  task?: CurationTask
}

type ParsedCliArgs = {
  command: CurationCommand
  config: ParsedCurationConfig
}
type CurationSupabaseClient = Parameters<typeof runEnrich>[1]

function isCurationCommand(command: string | undefined): command is CurationCommand {
  return COMMANDS.includes(command as CurationCommand)
}

function parseNumberFlag(args: string[], name: string): number | undefined {
  const flag = `--${name}`
  const equalsArg = args.find((arg) => arg.startsWith(`${flag}=`))
  const rawValue = equalsArg?.slice(flag.length + 1)

  if (rawValue === undefined) {
    const index = args.indexOf(flag)
    const nextValue = index >= 0 ? args[index + 1] : undefined

    if (!nextValue || nextValue.startsWith('--')) {
      return undefined
    }

    const value = Number.parseInt(nextValue, 10)
    return Number.isNaN(value) ? undefined : value
  }

  const value = Number.parseInt(rawValue, 10)
  return Number.isNaN(value) ? undefined : value
}

function parseCsvFlag(args: string[], name: string): string[] | undefined {
  const rawValue = args.find((arg) => arg.startsWith(`--${name}=`))?.replace(`--${name}=`, '')

  if (!rawValue) {
    return undefined
  }

  return rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function parseStringFlag(args: string[], name: string): string | undefined {
  const flag = `--${name}`
  const equalsArg = args.find((arg) => arg.startsWith(`${flag}=`))
  const rawValue = equalsArg?.slice(flag.length + 1)

  if (rawValue === undefined) {
    const index = args.indexOf(flag)
    const nextValue = index >= 0 ? args[index + 1] : undefined

    if (!nextValue || nextValue.startsWith('--')) {
      return undefined
    }

    return nextValue.trim() || undefined
  }

  return rawValue.trim() || undefined
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const [command, ...args] = argv

  if (!isCurationCommand(command)) {
    throw new Error(`Unknown command: ${command ?? '(none)'}`)
  }

  const config: ParsedCurationConfig = {
    dryRun: args.includes('--dry-run'),
    overwrite: args.includes('--overwrite'),
  }
  const slugs = parseCsvFlag(args, 'slugs')
  const limit = parseNumberFlag(args, 'limit')
  const statusRaw = parseStringFlag(args, 'status')
  const VALID_BRAND_STATUSES = [
    'approved',
    'hidden',
  ] as const satisfies readonly BrandStatus[]
  const status = VALID_BRAND_STATUSES.includes(statusRaw as BrandStatus)
    ? (statusRaw as BrandStatus)
    : undefined

  if (status && !slugs?.length) {
    console.warn(
      '--status without --slugs is deprecated. Default enrichment now targets submissions. Use --slugs for brand re-enrichment.'
    )
  }

  if (slugs) {
    config.slugs = slugs
  }

  if (limit !== undefined) {
    config.limit = limit
  }

  if (status) {
    config.status = status
  }

  if (command === 'enrich') {
    const phases = parseCsvFlag(args, 'phases')
    // Retired names (`links`) map to the phase that does their work today and
    // deferred names are dropped, so `--phases=links` scrapes something instead
    // of nothing. With no flag the scope is the `full` closure, never
    // `[...ENRICH_PHASES]` — that array still carries the deferred names.
    config.phases = phases
      ? (normalizeRequestedPhases(phases) as EnrichPhase[])
      : (phasesForTask('full') as EnrichPhase[])

    // --task is the operator-facing selection; --phases stays for the
    // fine-grained reruns that job history and phase_results are written in.
    const taskFlag = args.find(a => a.startsWith('--task='))?.split('=')[1]
    if (taskFlag && (CURATION_TASK_ORDER as readonly string[]).includes(taskFlag)) {
      config.task = taskFlag as CurationTask
    }
  }

  return { command, config }
}

function printUsage(): void {
  console.log('Usage: pnpm curate <command> [options]')
  console.log('')
  console.log('Commands:')
  console.log(
    '  enrich           Clean, detect, discover links, enrich images/descriptions, and classify tags'
  )
  console.log('')
  console.log('Options:')
  console.log('  --dry-run')
  console.log(
    '  --slugs=a,b                                  queue scheduled brand refresh requests'
  )
  console.log('  --status=approved')
  console.log('  --limit=10')
  console.log(`  --task=${CURATION_TASK_ORDER.join('|')}  enrich only (preferred)`)
  console.log(`  --phases=${ENRICH_PHASES.join(',')}  enrich only`)
  console.log('  --overwrite                                  submission enrichment only')
}

function printResult(command: CurationCommand, result: OperationResult, dryRun: boolean): void {
  console.log('')
  console.log('--- Summary ---')
  console.log(`Command: ${command}`)
  console.log(`Mode: ${dryRun ? 'dry run' : 'apply'}`)
  console.log(`Processed: ${result.processed}`)
  console.log(`Updated: ${result.updated}`)
  console.log(`Skipped: ${result.skipped}`)
  console.log(`Errors: ${result.errors.length}`)

  for (const error of result.errors) {
    console.log(`  ${error}`)
  }
}

async function runCommand({ command, config }: ParsedCliArgs): Promise<OperationResult> {
  const supabase = createServiceClient() as unknown as CurationSupabaseClient
  const runConfig: ParsedCurationConfig = {
    ...config,
    onProgress: (message) => console.log(message),
  }

  switch (command) {
    case 'enrich': {
      if (config.slugs?.length) {
        const requesterEmail = process.env.ADMIN_EMAILS?.split(',')
          .map((email) => email.trim())
          .find(Boolean)
        if (!requesterEmail) {
          throw new Error('ADMIN_EMAILS must contain an admin account to request brand refreshes')
        }
        const outcomes = await requestBrandRefreshesBySlugs(config.slugs, requesterEmail, {
          dryRun: config.dryRun,
        })
        return {
          processed: outcomes.length,
          updated: outcomes.filter((outcome) => outcome.error === null).length,
          skipped: outcomes.filter((outcome) => outcome.error !== null).length,
          errors: outcomes.flatMap((outcome) =>
            outcome.error ? [`${outcome.slug}: ${outcome.error}`] : []
          ),
          brandOutcomes: outcomes.map((outcome) => ({
            slug: outcome.slug,
            name: outcome.name,
            status: outcome.error ? 'failed' : 'succeeded',
            changedFields: outcome.submissionId ? ['refresh_request'] : [],
          })),
        }
      }
      return runEnrich(
        {
          ...runConfig,
          phases: runConfig.task
            ? phasesForTask(runConfig.task)
            : runConfig.phases ?? phasesForTask('full'),
          ...(runConfig.task ? { task: runConfig.task } : {}),
          explicitPhases: runConfig.task ? [] : runConfig.phases ?? [],
        },
        supabase
      )
    }
  }
}

async function main(): Promise<void> {
  const { argv } = loadScriptTarget()
  try {
    const parsed = parseCliArgs(argv)
    const result = await runCommand(parsed)
    printResult(parsed.command, result, parsed.config.dryRun)

    if (result.errors.length > 0) {
      process.exitCode = 1
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    printUsage()
    process.exitCode = 1
  } finally {
    await flushLangfuse()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main()
}
