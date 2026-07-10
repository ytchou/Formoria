import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { createServiceClient } from '@/lib/supabase/server'
import {
  type CurationConfig,
  type OperationResult,
  runEnrich,
} from '@/lib/services/curation-operations'
import {
  classificationPrecision,
  languagePurity,
  lengthBand,
  type LabeledImage,
} from '@/lib/services/eval/scorers'

const COMMANDS = ['enrich', 'eval'] as const
const DEFAULT_ENRICH_PHASES = [
  'clean',
  'detect',
  'slugs',
  'tags',
  'discover',
  'links',
  'images',
  'classify_images',
  'descriptions',
  'expansion',
] as const

type CurationCommand = (typeof COMMANDS)[number]
type EnrichPhase = (typeof DEFAULT_ENRICH_PHASES)[number]
type ParsedCurationConfig = CurationConfig & {
  phases?: EnrichPhase[]
}

type ParsedCliArgs = {
  command: CurationCommand
  config: ParsedCurationConfig
}
type CurationSupabaseClient = Parameters<typeof runEnrich>[1]
type GoldenBrand = {
  slug: string
  reasons?: string[]
  labels: {
    heroExpected?: string
    images: LabeledImage[]
    notes?: string
  }
}
type GoldenFixture = {
  approved: boolean
  brands: GoldenBrand[]
}
type EvalBrandRow = {
  id: string
  slug: string
  description: string | null
  hero_image_url: string | null
}
type AiResultRow = {
  raw_response: unknown
}
type EvalBrandScore = {
  slug: string
  purity: number
  lengthOk: boolean
  heroJunkViolation: boolean
  precision: number | null
}

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
  const VALID_BRAND_STATUSES = ['approved', 'hidden'] as const
  type BrandStatus = (typeof VALID_BRAND_STATUSES)[number]
  const status = VALID_BRAND_STATUSES.includes(statusRaw as BrandStatus) ? (statusRaw as BrandStatus) : undefined

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
  console.log('  enrich           Clean, detect, discover links, enrich images/descriptions, and classify tags')
  console.log('  eval             Score current enriched DB state against the approved golden set')
  console.log('')
  console.log('Options:')
  console.log('  --dry-run')
  console.log('  --slugs=a,b')
  console.log('  --status=approved')
  console.log('  --limit=10')
  console.log('  --phases=clean,detect,slugs,tags,discover,links,images,descriptions  enrich only')
  console.log('  --overwrite                                  re-enrich already enriched brands')
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isGoldenFixture(value: unknown): value is GoldenFixture {
  if (!isRecord(value) || typeof value.approved !== 'boolean' || !Array.isArray(value.brands)) {
    return false
  }

  return value.brands.every((brand) => {
    if (!isRecord(brand) || typeof brand.slug !== 'string' || !isRecord(brand.labels)) {
      return false
    }

    return Array.isArray(brand.labels.images)
  })
}

async function loadGoldenFixture(): Promise<GoldenFixture> {
  const filePath = path.join(process.cwd(), 'scripts/eval/golden-brands.json')
  const fixture = JSON.parse(await readFile(filePath, 'utf8')) as unknown

  if (!isGoldenFixture(fixture)) {
    throw new Error('Invalid golden-brands.json schema')
  }

  return fixture
}

function extractUrlTagPairs(value: unknown): Array<readonly [string, string]> {
  if (Array.isArray(value)) {
    return value.flatMap(extractUrlTagPairs)
  }

  if (!isRecord(value)) {
    return []
  }

  const url = value.url
  const tag = value.tag ?? value.classification ?? value.label ?? value.type
  const current = typeof url === 'string' && typeof tag === 'string' ? [[url, tag] as const] : []
  const nested = ['images', 'imageClassifications', 'classifications', 'results', 'items']
    .flatMap((key) => extractUrlTagPairs(value[key]))

  return [...current, ...nested]
}

function buildPredictedImageTags(aiRows: AiResultRow[]): Map<string, string> {
  return new Map(aiRows.flatMap((row) => extractUrlTagPairs(row.raw_response)))
}

function hasHeroJunkViolation(brand: EvalBrandRow, labels: GoldenBrand['labels']): boolean {
  if (!brand.hero_image_url) {
    return false
  }

  return labels.images.some((image) => image.url === brand.hero_image_url && image.junk)
}

function printEvalScores(scores: EvalBrandScore[]): void {
  console.log('')
  console.log('--- Eval Scores ---')

  for (const score of scores) {
    console.log(
      [
        score.slug,
        `purity=${score.purity.toFixed(3)}`,
        `length=${score.lengthOk ? 'ok' : 'out-of-band'}`,
        `heroJunk=${score.heroJunkViolation ? 'violation' : 'ok'}`,
        `precision=${score.precision === null ? 'n/a' : score.precision.toFixed(3)}`,
      ].join('  ')
    )
  }

  const avgPurity = scores.reduce((sum, score) => sum + score.purity, 0) / Math.max(scores.length, 1)
  const lengthPasses = scores.filter((score) => score.lengthOk).length
  const heroJunkViolations = scores.filter((score) => score.heroJunkViolation).length
  const precisionScores = scores
    .map((score) => score.precision)
    .filter((score): score is number => typeof score === 'number')
  const avgPrecision =
    precisionScores.reduce((sum, score) => sum + score, 0) / Math.max(precisionScores.length, 1)

  console.log('')
  console.log('--- Aggregate ---')
  console.log(`Average purity: ${avgPurity.toFixed(3)}`)
  console.log(`Length band pass: ${lengthPasses}/${scores.length}`)
  console.log(`Hero-junk violations: ${heroJunkViolations}`)
  console.log(`Classification precision: ${precisionScores.length === 0 ? 'n/a' : avgPrecision.toFixed(3)}`)
}

async function runEval(supabase: CurationSupabaseClient): Promise<OperationResult> {
  const fixture = await loadGoldenFixture()

  if (!fixture.approved || fixture.brands.length === 0) {
    console.log('No approved golden set. Run select-golden first.')
    return { processed: 0, updated: 0, skipped: 0, errors: [], brandOutcomes: [] }
  }

  const scores: EvalBrandScore[] = []
  const errors: string[] = []

  for (const goldenBrand of fixture.brands) {
    const brandResult = await supabase
      .from('brands')
      .select('id, slug, description, hero_image_url')
      .eq('slug', goldenBrand.slug)
      .maybeSingle()

    if (brandResult.error) {
      errors.push(`${goldenBrand.slug}: ${brandResult.error.message}`)
      continue
    }

    if (!brandResult.data) {
      errors.push(`${goldenBrand.slug}: brand not found`)
      continue
    }

    const brand = brandResult.data as EvalBrandRow
    const aiResult = await supabase
      .from('brand_ai_results')
      .select('raw_response')
      .eq('brand_id', brand.id)
      .order('created_at', { ascending: false })

    if (aiResult.error) {
      errors.push(`${goldenBrand.slug}: ${aiResult.error.message}`)
      continue
    }

    const predicted = buildPredictedImageTags((aiResult.data ?? []) as AiResultRow[])
    const labeledImages = goldenBrand.labels.images
    const hasClassifications = labeledImages.some((image) => predicted.has(image.url))
    const heroImages = brand.hero_image_url ? [brand.hero_image_url] : []

    scores.push({
      slug: goldenBrand.slug,
      purity: languagePurity(brand.description ?? '', 'zh'),
      lengthOk: lengthBand(brand.description ?? '', [300, 600]),
      heroJunkViolation: hasHeroJunkViolation(brand, goldenBrand.labels),
      precision: hasClassifications
        ? classificationPrecision(labeledImages, predicted)
        : null,
    })

    console.log(
      `${goldenBrand.slug}: hero=${brand.hero_image_url ?? 'none'} images=${new Set(heroImages).size}`
    )
  }

  printEvalScores(scores)

  return {
    processed: scores.length,
    updated: 0,
    skipped: fixture.brands.length - scores.length,
    errors,
    brandOutcomes: scores.map((score) => ({
      slug: score.slug,
      name: score.slug,
      status: 'succeeded',
      changedFields: [],
    })),
  }
}

async function runCommand({ command, config }: ParsedCliArgs): Promise<OperationResult> {
  const supabase = createServiceClient() as unknown as CurationSupabaseClient
  const runConfig: ParsedCurationConfig = {
    ...config,
    onProgress: (message) => console.log(message),
  }

  switch (command) {
    case 'enrich':
      return runEnrich(
        {
          ...runConfig,
          phases: runConfig.phases ?? [...DEFAULT_ENRICH_PHASES],
        },
        supabase
      )
    case 'eval':
      return runEval(supabase)
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
