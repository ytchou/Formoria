/**
 * @formoria-script
 * purpose: Smoke-test the six DEV-1824 TypeSafe Jev eval candidates against the live Jev API on inline zh-TW fixtures
 * class: operator
 * invoke: pnpm jev:smoke [--target staging|production]
 * target: staging-default
 * safety: read-only
 * owner: engineering
 * notes: Eval-only. Needs TYPESAFE_API_KEY. A no-op setAuditWriteSeam swallows audit writes, so no external_call_audit rows are written. Exits 1 when any candidate throws or reports an unknown cost.
 */
import { loadScriptTarget } from '../shared/target'

// @/ imports are loaded dynamically, after loadScriptTarget() sets up env.

type SmokeResult = { output: unknown; latencyMs: number; costUsd: number | null }
type SmokeCase = { name: string; run: () => Promise<SmokeResult> }

async function main(): Promise<void> {
  loadScriptTarget()

  const [
    { setAuditWriteSeam },
    { decide },
    { JEV_CANDIDATES, runJevCandidate },
    { JEV_INPUT_LABELS },
    { SITE_IDENTITY_LABELS },
  ] = await Promise.all([
    import('@/lib/audit'),
    import('@/lib/services/typesafe-audit'),
    import('@/lib/services/eval/jev-questions'),
    import('@/lib/prompts/jev'),
    import('@/lib/prompts'),
  ])

  const L = JEV_INPUT_LABELS
  const S = SITE_IDENTITY_LABELS
  const decideFn = (
    profileKey: string,
    state: Parameters<typeof decide>[1],
    questions: Parameters<typeof decide>[2],
  ) => decide(profileKey, state, questions)

  // Inline fixtures in the live prompt shapes documented at the top of jev-questions.ts.
  const cases: SmokeCase[] = [
    {
      name: 'detect',
      run: () =>
        runJevCandidate(JEV_CANDIDATES.detect, decideFn, {
          user: [
            `${L.brandSlug}：mountain-tea-studio`,
            `${L.brandName}：山茶工作室`,
            `${L.description}：來自南投鹿谷的小農茶品牌，自產自焙凍頂烏龍茶`,
            `${L.website}：https://example.com`,
            `${L.searchSnippets}：山茶工作室 凍頂烏龍 手工烘焙；南投鹿谷 茶農 第三代`,
          ].join('\n'),
          promptName: 'detect',
        }),
    },
    {
      name: 'classification',
      run: () =>
        runJevCandidate(JEV_CANDIDATES.classification, decideFn, {
          user: [
            `${L.brandName}：山茶工作室`,
            `${L.description}：來自南投鹿谷的小農茶品牌，自產自焙凍頂烏龍茶`,
          ].join('\n'),
          promptName: 'category-classify',
        }),
    },
    {
      name: 'siteIdentity',
      run: () =>
        runJevCandidate(JEV_CANDIDATES.siteIdentity, decideFn, {
          user: `${S.userPreamble}\n1. [mountain-tea-studio] ${[
            `${S.brandName}：山茶工作室`,
            `${S.categorySlug}：food`,
            S.subjectKind.website,
            `${S.url}：https://example.com`,
            `${S.title}：山茶工作室｜南投鹿谷凍頂烏龍`,
            `${S.description}：第三代茶農自產自焙的凍頂烏龍茶`,
            `${S.story}：我們在鹿谷山上種茶三十年，每一批茶都親手烘焙。`,
          ].join(' / ')}`,
          promptName: 'site-identity',
        }),
    },
    {
      name: 'productCategory',
      run: () =>
        runJevCandidate(
          JEV_CANDIDATES.productCategory,
          decideFn,
          [`${L.productName}：凍頂烏龍茶 150g`, `${L.description}：南投鹿谷手工烘焙的焙火烏龍茶葉`].join('\n'),
        ),
    },
    {
      name: 'intentParse',
      run: () => runJevCandidate(JEV_CANDIDATES.intentParse, decideFn, { query: '送長輩的台灣茶葉禮盒' }),
    },
    {
      name: 'relevanceJudge',
      run: () =>
        runJevCandidate(JEV_CANDIDATES.relevanceJudge, decideFn, {
          query: '送長輩的台灣茶葉禮盒',
          product: {
            name_zh: '凍頂烏龍茶禮盒',
            description_zh: '南投鹿谷手工烘焙的凍頂烏龍茶，附木質禮盒，適合送禮',
          },
        }),
    },
  ]

  // Collector no-op: nothing reaches external_call_audit. Restored in `finally`.
  setAuditWriteSeam(async () => null)
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
    setAuditWriteSeam(null)
  }

  console.log(`\n[jev:smoke] ${cases.length - failures}/${cases.length} candidates passed`)
  if (failures > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
