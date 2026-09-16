/**
 * @formoria-script
 * purpose: Retrieval evaluation harness — runs search arms on the shared experiment framework, computes metrics, reports neighbours.
 * class: operator
 * invoke: pnpm search:eval
 * target: staging-default
 * safety: read-only
 * owner: engineering
 * notes: `run` uses the shared runExperiment harness with zero-write seams. `neighbours` is read-only.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { parseArgs } from 'node:util'

import { loadScriptTarget } from '../../../shared/target'
import {
  searchProductsBySituation,
  findSimilarProducts,
} from '@/lib/services/product-situation-search'
import { getPublishedCuratedProducts } from '@/lib/services/curated-products-catalog'
import { rerankProducts } from '@/lib/services/product-rerank'
import {
  bootstrapCI,
  pairedBootstrapCI,
  mean,
} from '@/lib/services/eval/scorers'
import {
  createRetrievalAdapter,
  type RetrievalAdapterDeps,
} from '@/lib/services/eval/retrieval-adapter'
import { createScriptExperimentDeps } from '@/lib/services/eval/script-experiment-deps'
import {
  runExperiment,
  type ExperimentArm,
  type ExperimentResult,
} from '@/lib/services/eval/run-experiment'
import { loadDatasetV2, toExperimentItems } from './dataset-v2'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname)
const DATASET_PATH = resolve(SCRIPT_DIR, 'dataset-v2.json')
const RUNS_DIR = resolve(SCRIPT_DIR, 'runs')

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

export type ReportOutput = {
  timestamp: string
  arms: Record<string, Record<string, { lo: number; hi: number; mean: number }>>
  paired: { ndcgAt10: { lo: number; hi: number; mean: number; signTestP: number } }
  byQueryType: Record<string, Record<string, Record<string, number>>>
  verdict: 'proceed' | 'null'
}

// ---------------------------------------------------------------------------
// writeReport
// ---------------------------------------------------------------------------

export function writeReport(
  result: ExperimentResult,
  opts: {
    seed: number
    out?: string
    queryTypes?: Map<string, string>
  },
): ReportOutput {
  const metricNames = ['ndcg@10', 'precision@5', 'recall@100', 'mrr']

  // Per-arm CIs
  const arms: ReportOutput['arms'] = {}
  for (const ar of result.armResults) {
    const armCis: Record<string, { lo: number; hi: number; mean: number }> = {}
    for (const metric of metricNames) {
      const values = ar.items.map((i) => i.scores[metric] ?? 0)
      armCis[metric] = bootstrapCI(values, 1000, 0.05, { seed: opts.seed })
    }
    arms[ar.arm] = armCis
  }

  // Paired NDCG@10 delta between first two arms
  let paired: ReportOutput['paired'] = {
    ndcgAt10: { lo: 0, hi: 0, mean: 0, signTestP: 1 },
  }
  if (result.armResults.length >= 2) {
    const a = result.armResults[0]!
    const b = result.armResults[1]!
    // Build aligned per-item scores (same item order)
    const aScores = a.items.map((i) => i.scores['ndcg@10'] ?? 0)
    const bScores = b.items.map((i) => i.scores['ndcg@10'] ?? 0)
    // Delta: second arm - first arm (improvement of arm B over arm A)
    paired = {
      ndcgAt10: pairedBootstrapCI(bScores, aScores, {
        nBoot: 1000,
        seed: opts.seed,
      }),
    }
  }

  // Per-queryType breakdown
  const byQueryType: ReportOutput['byQueryType'] = {}
  if (opts.queryTypes && opts.queryTypes.size > 0) {
    const queryTypeSet = new Set(opts.queryTypes.values())
    for (const qt of queryTypeSet) {
      byQueryType[qt] = {}
      for (const ar of result.armResults) {
        const filtered = ar.items.filter(
          (i) => opts.queryTypes!.get(i.itemId) === qt,
        )
        const armMeans: Record<string, number> = {}
        for (const metric of metricNames) {
          armMeans[metric] = mean(filtered.map((i) => i.scores[metric] ?? 0))
        }
        byQueryType[qt]![ar.arm] = armMeans
      }
    }
  }

  // Verdict
  const verdict: ReportOutput['verdict'] = paired.ndcgAt10.lo > 0 ? 'proceed' : 'null'

  const report: ReportOutput = {
    timestamp: new Date().toISOString(),
    arms,
    paired,
    byQueryType,
    verdict,
  }

  if (opts.out) {
    mkdirSync(dirname(opts.out), { recursive: true })
    writeFileSync(opts.out, JSON.stringify(report, null, 2))
  }

  return report
}

// ---------------------------------------------------------------------------
// Subcommand: run (new — uses shared experiment harness)
// ---------------------------------------------------------------------------

async function cmdRun(
  armSpecs: string[],
  split: string,
  _k: number,
  out: string | undefined,
  allowUnreviewed: boolean,
) {
  const items = loadDatasetV2(DATASET_PATH, { split })
  const experimentItems = toExperimentItems(items)

  // Build queryType map for the report
  const queryTypes = new Map<string, string>()
  for (const item of items) {
    if (item.queryType) {
      queryTypes.set(item.id, item.queryType)
    }
  }

  // Build arms
  const arms: ExperimentArm[] = armSpecs.map((spec) => ({
    name: spec,
    type: 'custom' as const,
    value: spec,
  }))

  // Build retrieval adapter with real deps
  const deps: RetrievalAdapterDeps = {
    search: async (input) => {
      const result = await searchProductsBySituation({
        query: input.query,
        locale: input.locale,
        mode: input.mode,
        pageSize: input.pageSize,
        category: input.category ?? null,
        enableIntentParse: input.enableIntentParse,
      })
      return {
        products: result.products.map((p) => ({
          id: p.id,
          key: p.key,
          brandSlug: p.brandSlug,
        })),
      }
    },
    category: async (opts) => {
      const result = await getPublishedCuratedProducts({
        category: opts.category,
        pageSize: opts.pageSize ?? 100,
      })
      return {
        products: result.products.map((p) => ({
          id: p.id,
          key: p.key,
          brandSlug: p.brandSlug,
        })),
      }
    },
    rerank: async (query, candidates) => {
      const reranked = await rerankProducts(query, candidates)
      return reranked.map((c) => ({ id: c.id }))
    },
    // rank: undefined — wired in Task 8
  }

  const adapter = createRetrievalAdapter(deps)
  const scriptDeps = await createScriptExperimentDeps({
    adapter,
    profileKey: adapter.profileKey,
  })

  console.log(
    `[run] ${experimentItems.length} items (split=${split}), ${arms.length} arms`,
  )

  const result = await runExperiment({
    dataset: `search-eval-v2-${split}`,
    arms,
    adapter,
    items: experimentItems,
    allowUnreviewed,
    deps: scriptDeps,
  })

  console.log(result.markdown)

  const report = writeReport(result, {
    seed: 1736,
    out: out ?? resolve(RUNS_DIR, `dev-1736-report.json`),
    queryTypes,
  })

  console.log(`\nVerdict: ${report.verdict}`)
  if (result.provisional) {
    console.log('(provisional — unreviewed items included)')
  }
  process.exitCode = result.exitCode
}

// ---------------------------------------------------------------------------
// Subcommand: neighbours (migrated to dataset-v2)
// ---------------------------------------------------------------------------

async function cmdNeighbours(limit: number) {
  const items = loadDatasetV2(DATASET_PATH)

  // Build a map of composite key → product id from the catalog
  const { products: allProducts, totalCount } =
    await getPublishedCuratedProducts({
      pageSize: Number.MAX_SAFE_INTEGER,
    })
  if (allProducts.length !== totalCount) {
    throw new Error(
      `catalog read truncated: got ${allProducts.length} of ${totalCount}`,
    )
  }

  const keyToId = new Map<string, string>()
  for (const p of allProducts) {
    keyToId.set(`${p.brandSlug}/${p.key}`, p.id)
  }

  // Collect all unique expected product IDs
  const allIds = new Set<string>()
  const missing: Array<{ queryId: string; key: string }> = []
  for (const item of items) {
    for (const exp of item.expected) {
      const ck = `${exp.brandSlug}/${exp.productKey}`
      const id = keyToId.get(ck)
      if (id) {
        allIds.add(id)
      } else {
        missing.push({ queryId: item.id, key: ck })
      }
    }
  }

  if (missing.length > 0) {
    console.warn(`[neighbours] ${missing.length} expected products not found`)
  }

  console.log(
    `[neighbours] Finding ${limit} neighbours for ${allIds.size} products...\n`,
  )

  for (const productId of allIds) {
    const { products } = await findSimilarProducts(productId, limit)
    console.log(`### Product: ${productId}`)
    if (products.length === 0) {
      console.log('  (no neighbours found)\n')
      continue
    }
    for (const p of products) {
      console.log(`  - ${p.nameZh} (${p.brandSlug}/${p.key})`)
    }
    console.log()
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const { argv: remainingArgv } = loadScriptTarget()

  const { positionals, values } = parseArgs({
    args: remainingArgv,
    allowPositionals: true,
    options: {
      arm: { type: 'string', default: 'hybrid' },
      split: { type: 'string', default: 'holdout' },
      k: { type: 'string', default: '10' },
      out: { type: 'string' },
      limit: { type: 'string', default: '5' },
      'allow-unreviewed': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  })

  const subcommand = positionals[0]

  switch (subcommand) {
    case 'run':
      await cmdRun(
        (values.arm ?? 'hybrid').split(','),
        values.split ?? 'holdout',
        parseInt(values.k ?? '10', 10),
        values.out,
        values['allow-unreviewed'] ?? false,
      )
      break
    case 'neighbours':
      await cmdNeighbours(parseInt(values.limit ?? '5', 10))
      break
    case 'generate-queries':
      await import('./label-generate-queries').then((m) =>
        m.cmdGenerateQueries(values),
      )
      break
    case 'judge':
      await import('./label-judge').then((m) => m.cmdJudge(values))
      break
    case 'retrieve-candidates':
      await import('./label-judge').then((m) =>
        m.cmdRetrieveCandidates(values),
      )
      break
    case 'agreement':
      await import('./label-agreement').then((m) => m.cmdAgreement(values))
      break
    case 'build-dataset':
      await import('./label-build-dataset').then((m) =>
        m.cmdBuildDataset(values),
      )
      break
    default:
      console.error(
        'Usage: search:eval <run|neighbours|generate-queries|judge|retrieve-candidates|agreement|build-dataset>',
      )
      console.error(
        '  run [--arm hybrid,ltr:v1] [--split holdout] [--k 10] [--out path] [--allow-unreviewed]',
      )
      console.error('  neighbours [--limit 5]')
      console.error(
        '  generate-queries [--count 100]   Generate zh-TW situation query candidates',
      )
      console.error(
        '  judge [--model gpt-4o-mini]      Run LLM judge on (query, product) pairs',
      )
      console.error(
        '  retrieve-candidates [--mode hybrid] [--pageSize 100]',
      )
      console.error(
        '  agreement [--human f] [--llm f]  Compute Cohen\'s kappa between labels',
      )
      console.error(
        '  build-dataset [--split 60/20/20] Build labelled dataset for Langfuse',
      )
      process.exitCode = 1
  }
}

if (!process.env.VITEST) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
