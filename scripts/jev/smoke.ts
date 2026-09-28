/**
 * @formoria-script
 * purpose: Smoke-test the four DEV-1824 TypeSafe Jev eval candidates against the live Jev API on inline zh-TW fixtures
 * class: operator
 * invoke: pnpm jev:smoke [--target staging|production]
 * target: staging-default
 * safety: read-only
 * owner: engineering
 * notes: Eval-only. Needs TYPESAFE_API_KEY. installSeams (eval/zero-write) collects audit writes in memory, so no external_call_audit rows are written. Exits 1 when any candidate throws or reports an unknown cost.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadScriptTarget } from '../shared/target'

// @/ imports are loaded dynamically, after loadScriptTarget() sets up env.

type SmokeResult = { output: unknown; latencyMs: number; costUsd: number | null }
type SmokeCase = { name: string; run: () => Promise<SmokeResult> }

async function main(): Promise<void> {
  loadScriptTarget()

  const [
    { installSeams },
    { decide },
    { JEV_CANDIDATES, runJevCandidate },
    { JEV_INPUT_LABELS },
    { renderDetectUserMessage },
    { snapshotPrompt },
  ] = await Promise.all([
    import('@/lib/services/eval/zero-write'),
    import('@/lib/services/typesafe-audit'),
    import('@/lib/services/eval/jev-questions'),
    import('@/lib/prompts/jev'),
    import('@/lib/services/category-classifier'),
    import('@/lib/langfuse/prompt'),
  ])

  const L = JEV_INPUT_LABELS

  // Inline fixtures in the live prompt shapes documented at the top of jev-questions.ts.
  const cases: SmokeCase[] = [
    {
      name: 'detect',
      run: () =>
        runJevCandidate(JEV_CANDIDATES.detect, decide, {
          user: renderDetectUserMessage({
            slug: 'mountain-tea-studio',
            name: '山茶工作室',
            description: '來自南投鹿谷的小農茶品牌，自產自焙凍頂烏龍茶',
            website: 'https://example.com',
            submittedWebsite: 'https://example.com',
            results: [
              { title: '山茶工作室', snippet: '凍頂烏龍 手工烘焙', host: 'example.com', match: 'site' },
              { title: '南投鹿谷 茶農 第三代', host: 'news.example.org', match: null },
            ],
            probes: [{ url: 'https://example.com', title: '山茶工作室', description: '自產自焙凍頂烏龍茶' }],
          }),
          promptName: 'detect',
          // The eval adapter injects the pinned detect prompt the same way (DEV-1894 D13).
          rules: snapshotPrompt('detect').text,
        }),
    },
    {
      name: 'productCategory',
      run: () =>
        runJevCandidate(
          JEV_CANDIDATES.productCategory,
          decide,
          [`${L.productName}：凍頂烏龍茶 150g`, `${L.description}：南投鹿谷手工烘焙的焙火烏龍茶葉`].join('\n'),
        ),
    },
    {
      name: 'intentParse',
      run: () => runJevCandidate(JEV_CANDIDATES.intentParse, decide, { query: '送長輩的台灣茶葉禮盒' }),
    },
    {
      name: 'relevanceJudge',
      run: () =>
        runJevCandidate(JEV_CANDIDATES.relevanceJudge, decide, {
          query: '送長輩的台灣茶葉禮盒',
          product: {
            name_zh: '凍頂烏龍茶禮盒',
            description_zh: '南投鹿谷手工烘焙的凍頂烏龍茶，附木質禮盒，適合送禮',
          },
        }),
    },
  ]

  // Audit writes go to an in-memory collector; nothing reaches external_call_audit. Restored in `finally`.
  const seams = installSeams({ sinkPath: join(tmpdir(), `jev-smoke-${process.pid}.jsonl`) })
  let failures = 0
  try {
    for (const smokeCase of cases) {
      try {
        const result = await smokeCase.run()
        console.log(`\n[jev:smoke] ${smokeCase.name}`)
        console.log(JSON.stringify(result.output, null, 2))
        console.log(`  latencyMs=${result.latencyMs} costUsd=${result.costUsd ?? 'unknown'}`)
        if (result.costUsd === null) {
          failures += 1
          console.error(`  FAIL: ${smokeCase.name} returned an unknown cost`)
        }
      } catch (err) {
        failures += 1
        console.error(
          `\n[jev:smoke] FAIL: ${smokeCase.name}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  } finally {
    seams.restore()
  }

  console.log(`\n[jev:smoke] ${cases.length - failures}/${cases.length} candidates passed`)
  if (failures > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
