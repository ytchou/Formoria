import { createServiceClient } from '@/lib/supabase/server'
import {
  type CurationConfig,
  type OperationResult,
  runAutoTag,
  runCleanup,
  runEnrich,
  runSetVisibility,
} from '@/lib/services/curation-operations'

const COMMANDS = ['cleanup', 'enrich', 'auto-tag', 'set-visibility'] as const
const DEFAULT_ENRICH_PHASES = ['discover', 'links', 'images', 'descriptions'] as const

type CurationCommand = (typeof COMMANDS)[number]
type EnrichPhase = (typeof DEFAULT_ENRICH_PHASES)[number]
type ParsedCurationConfig = CurationConfig & {
  phases?: EnrichPhase[]
}

type ParsedCliArgs = {
  command: CurationCommand
  config: ParsedCurationConfig
}
type CurationSupabaseClient = Parameters<typeof runCleanup>[1]

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
  const rawValue = args
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.replace(`--${name}=`, '')

  if (!rawValue) {
    return undefined
  }

  return rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const [command, ...args] = argv

  if (!isCurationCommand(command)) {
    throw new Error(`Unknown command: ${command ?? '(none)'}`)
  }

  const config: ParsedCurationConfig = {
    dryRun: args.includes('--dry-run'),
  }
  const slugs = parseCsvFlag(args, 'slugs')
  const limit = parseNumberFlag(args, 'limit')

  if (slugs) {
    config.slugs = slugs
  }

  if (limit !== undefined) {
    config.limit = limit
  }

  if (command === 'enrich') {
    const phases = parseCsvFlag(args, 'phases')
    config.phases = phases
      ? phases.filter((phase): phase is EnrichPhase => {
          return DEFAULT_ENRICH_PHASES.includes(phase as EnrichPhase)
        })
      : [...DEFAULT_ENRICH_PHASES]
  }

  return { command, config }
}

function printUsage(): void {
  console.log('Usage: pnpm curate <command> [options]')
  console.log('')
  console.log('Commands:')
  console.log('  cleanup          Clean names, normalize slugs, and detect non-brand signals')
  console.log('  enrich           Discover links and enrich links, images, and descriptions')
  console.log('  auto-tag         Assign product_type categories')
  console.log('  set-visibility   Update visibility from approval/readiness fields')
  console.log('')
  console.log('Options:')
  console.log('  --dry-run')
  console.log('  --slugs=a,b')
  console.log('  --limit=10')
  console.log('  --phases=discover,links,images,descriptions  enrich only')
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
    case 'cleanup':
      return runCleanup(runConfig, supabase)
    case 'enrich':
      return runEnrich(
        {
          ...runConfig,
          phases: runConfig.phases ?? [...DEFAULT_ENRICH_PHASES],
        },
        supabase
      )
    case 'auto-tag':
      return runAutoTag(runConfig, supabase)
    case 'set-visibility':
      return runSetVisibility(runConfig, supabase)
  }
}

async function main(): Promise<void> {
  try {
    const parsed = parseCliArgs(process.argv.slice(2))
    const result = await runCommand(parsed)
    printResult(parsed.command, result, parsed.config.dryRun)

    if (result.errors.length > 0) {
      process.exitCode = 1
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    printUsage()
    process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main()
}
