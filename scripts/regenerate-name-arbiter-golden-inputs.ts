/**
 * @formoria-script
 * purpose: Re-render name-arbiter-confidence-golden inputs through the production candidate normalizer and prompt builder (DEV-1874)
 * class: operator
 * invoke: npx tsx scripts/regenerate-name-arbiter-golden-inputs.ts [--apply]
 * target: staging-default
 * safety: dry-run-default
 * owner: engineering
 * notes: Writes to Langfuse dataset items only on --apply. Items production never sends to the arbiter (fewer than two distinct candidates) are archived, not deleted.
 */
import { loadScriptTarget } from './shared/target'

import { getLangfuse, flushLangfuse } from '@/lib/langfuse/client'
import { normalizeCandidates } from '@/lib/services/enrich-phases/names'
import { buildNameArbiterUserContent, type NameCandidate } from '@/lib/services/name-arbiter'

const DATASET = 'name-arbiter-confidence-golden'
const LINE_RE = /^1\. \[([^\]]+)\] 儲存名稱：(.*) \/ 候選：(.*)$/u

type ParsedLine = { slug: string; storedName: string; candidates: NameCandidate[] }

/** Inverse of formatNameArbiterItem for lines without evidence or snippets. */
export function parseGoldenLine(user: string): ParsedLine {
  const [header, line, ...rest] = user.split('\n')
  if (header !== '請裁決以下品牌的正式名稱：' || !line || rest.length > 0) {
    throw new Error(`Unexpected golden user text: ${user.slice(0, 80)}`)
  }
  const match = LINE_RE.exec(line)
  if (!match) throw new Error(`Unparseable golden line: ${line}`)
  const [, slug, storedName, candidateLine] = match
  const candidates = candidateLine === '無'
    ? []
    : candidateLine!.split('；').map((part) => {
        const sep = part.indexOf('：')
        if (sep === -1) throw new Error(`Unparseable candidate "${part}" in ${slug}`)
        return { source: part.slice(0, sep), value: part.slice(sep + 1) } as NameCandidate
      })
  return { slug: slug!, storedName: storedName!, candidates }
}

async function main() {
  const { argv } = loadScriptTarget()
  const apply = argv.includes('--apply')
  const langfuse = getLangfuse()
  if (!langfuse) throw new Error('Langfuse not configured')

  const dataset = await langfuse.getDataset(DATASET)
  let rewritten = 0
  let archived = 0

  for (const item of dataset.items) {
    const input = item.input as { user: string; promptName: string }
    const parsed = parseGoldenLine(input.user)
    const normalized = normalizeCandidates(parsed.storedName, parsed.candidates)
    const metadata = { ...((item.metadata as Record<string, unknown> | null) ?? {}) }

    if (normalized.length < 2) {
      // runNamesPhase skips the arbiter for these brands, so the item tests an unreachable path.
      console.log(`archive  ${parsed.slug}: ${normalized.length} distinct candidate(s)`)
      archived++
      if (apply) {
        await langfuse.createDatasetItem({
          datasetName: DATASET,
          id: item.id,
          input: item.input,
          expectedOutput: item.expectedOutput,
          status: 'ARCHIVED',
          metadata: { ...metadata, archivedBy: 'DEV-1874', archivedReason: 'fewer than two distinct candidates; production never calls the arbiter' },
        })
      }
      continue
    }

    const user = buildNameArbiterUserContent([{ slug: parsed.slug, storedName: parsed.storedName, candidates: normalized }])
    if (user === input.user) {
      console.log(`same     ${parsed.slug}`)
      continue
    }
    console.log(`rewrite  ${parsed.slug}\n  - ${input.user.split('\n')[1]}\n  + ${user.split('\n')[1]}`)
    rewritten++
    if (apply) {
      await langfuse.createDatasetItem({
        datasetName: DATASET,
        id: item.id,
        input: { ...input, user },
        expectedOutput: item.expectedOutput,
        status: item.status,
        metadata: { ...metadata, inputRegeneratedBy: 'DEV-1874', previousUser: input.user },
      })
    }
  }

  console.log(`\n${apply ? 'applied' : 'dry run'}: ${rewritten} rewritten, ${archived} archived, ${dataset.items.length} total`)
  await flushLangfuse()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
