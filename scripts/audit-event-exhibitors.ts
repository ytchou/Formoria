/**
 * No-network audit for event exhibitor ledgers.
 *
 * This command reads only versioned local files. It proposes deterministic
 * normalized-name/domain matches when a local brand snapshot is supplied, but
 * it never edits a ledger or changes an outcome.
 *
 *   pnpm audit:event-exhibitors
 *   pnpm audit:event-exhibitors -- --brands-file=/tmp/brands.json
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  exhibitorCoverage,
  parseExhibitorLedger,
  type EventExhibitorInput,
  type ParsedExhibitorLedger,
} from './seed-events'

export type AuditBrandCandidate = {
  slug: string
  name: string
  officialWebsite?: string | null
}

export type ExhibitorMatchProposal = {
  sourceKey: string
  normalizedName: string
  candidates: string[]
  ambiguity: 'none' | 'ambiguous' | 'unmatched'
}

export type ExhibitorAuditReport = {
  generatedAt: string
  network: 'not_used'
  ledgers: Array<{
    fileName: string
    eventSlug: string
    coverage: ReturnType<typeof exhibitorCoverage>
    proposals: ExhibitorMatchProposal[]
  }>
  invariantErrors: string[]
  outcomesChanged: false
}

export function normalizeMatchKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-TW')
    .replace(/&/g, 'and')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function hostname(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).hostname.toLocaleLowerCase()
  } catch {
    return null
  }
}

export function proposeExhibitorMatches(
  exhibitors: EventExhibitorInput[],
  brands: AuditBrandCandidate[],
): ExhibitorMatchProposal[] {
  return exhibitors.map((exhibitor) => {
    const normalizedName = normalizeMatchKey(
      [exhibitor.name, exhibitor.nameEn].filter(Boolean).join(' '),
    )
    const nameCandidates = brands.filter((brand) => {
      const candidateName = normalizeMatchKey(brand.name)
      return (
        candidateName === normalizeMatchKey(exhibitor.name) ||
        (typeof exhibitor.nameEn === 'string' &&
          candidateName === normalizeMatchKey(exhibitor.nameEn))
      )
    })
    const sourceHost = hostname(exhibitor.websiteUrl)
    const domainCandidates = sourceHost
      ? brands.filter((brand) => hostname(brand.officialWebsite) === sourceHost)
      : []
    const candidates = [
      ...new Set(
        [...nameCandidates, ...domainCandidates].map(
          (candidate) => candidate.slug,
        ),
      ),
    ].sort()
    return {
      sourceKey: exhibitor.sourceKey,
      normalizedName,
      candidates,
      ambiguity:
        candidates.length === 0
          ? 'unmatched'
          : candidates.length === 1
            ? 'none'
            : 'ambiguous',
    }
  })
}

async function loadLedgers(
  directory: string,
): Promise<ParsedExhibitorLedger[]> {
  const names = (await readdir(directory))
    .filter((name) => name.endsWith('.exhibitors.json'))
    .sort()
  const ledgers: ParsedExhibitorLedger[] = []
  for (const name of names) {
    const fileName = path.join(directory, name)
    const raw = JSON.parse(await readFile(fileName, 'utf8')) as unknown
    ledgers.push(parseExhibitorLedger(fileName, raw))
  }
  return ledgers
}

async function loadBrandSnapshot(
  fileName: string | undefined,
): Promise<AuditBrandCandidate[]> {
  if (!fileName) return []
  const raw = JSON.parse(await readFile(fileName, 'utf8')) as unknown
  if (!Array.isArray(raw))
    throw new Error(`${fileName}: brand snapshot must be an array`)
  return raw as AuditBrandCandidate[]
}

export async function buildAuditReport(
  options: {
    directory?: string
    brands?: AuditBrandCandidate[]
    generatedAt?: string
  } = {},
): Promise<ExhibitorAuditReport> {
  const ledgers = await loadLedgers(options.directory ?? 'content/events')
  const invariantErrors: string[] = []
  const reports = ledgers.map((ledger) => {
    const coverage = exhibitorCoverage(ledger.exhibitors)
    const checkpoint = ledger.reportTimeEvidence.checkpoint
    for (const zone of ['K1', 'K2', 'K3', 'S']) {
      if (coverage.byZone[zone] !== checkpoint[zone]) {
        invariantErrors.push(
          `${ledger.fileName}: ${zone} checkpoint ${checkpoint[zone] ?? 'missing'} != ${coverage.byZone[zone] ?? 0}`,
        )
      }
    }
    return {
      fileName: ledger.fileName,
      eventSlug: ledger.eventSlug,
      coverage,
      proposals: proposeExhibitorMatches(
        ledger.exhibitors,
        options.brands ?? [],
      ),
    }
  })
  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    network: 'not_used',
    ledgers: reports,
    invariantErrors,
    outcomesChanged: false,
  }
}

async function main(): Promise<void> {
  const argumentValue = (name: string): string | undefined => {
    const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))
    if (inline) return inline.slice(name.length + 1)
    const index = process.argv.indexOf(name)
    return index >= 0 ? process.argv[index + 1] : undefined
  }
  const brandsFile = argumentValue('--brands-file')
  const reportFile =
    argumentValue('--report') ??
    'docs/reviews/event-exhibitor-audit-report.json'
  const report = await buildAuditReport({
    brands: await loadBrandSnapshot(brandsFile),
  })
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(`Wrote no-network exhibitor audit report: ${reportFile}`)
  for (const ledger of report.ledgers) {
    console.log(
      `${ledger.eventSlug}: ${JSON.stringify(ledger.coverage.byZone)}`,
    )
  }
  if (report.invariantErrors.length > 0) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Exhibitor audit failed:', error)
    process.exit(1)
  })
}
