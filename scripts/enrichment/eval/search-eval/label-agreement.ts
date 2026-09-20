import { readFileSync, writeFileSync, existsSync } from 'node:fs'

import {
  HAND_LABEL_SHEET_PATH,
  JUDGED_PAIRS_PATH,
  AGREEMENT_PATH,
  fromCsv,
  cohenKappa,
  type JudgedPair,
} from './label-shared'

// ---------------------------------------------------------------------------
// cmdAgreement
// ---------------------------------------------------------------------------

export async function cmdAgreement(
  values: Record<string, unknown>,
): Promise<void> {
  if (values.help) {
    console.log(
      'Usage: pnpm search:eval agreement [--human labels/hand-label-sheet.csv]',
    )
    console.log(
      '  Computes Cohen\'s kappa between LLM grades and hand-labeled pairs',
    )
    return
  }

  const humanPath = String(values.human ?? HAND_LABEL_SHEET_PATH)

  if (!existsSync(humanPath)) {
    console.error(`[agreement] File not found: ${humanPath}`)
    process.exitCode = 1
    return
  }

  if (!existsSync(JUDGED_PAIRS_PATH)) {
    console.error('[agreement] No judged-pairs.json found. Run judge first.')
    process.exitCode = 1
    return
  }

  // Load hand-label sheet
  const sheetRows = fromCsv(readFileSync(humanPath, 'utf8'))
  const judgedPairs: JudgedPair[] = JSON.parse(readFileSync(JUDGED_PAIRS_PATH, 'utf8'))

  // Build LLM grade lookup by composite key
  const llmGrades = new Map<string, number>()
  for (const pair of judgedPairs) {
    const key = `${pair.queryId}|${pair.brandSlug}|${pair.productKey}`
    llmGrades.set(key, pair.grade)
  }

  // Join on composite key - only rows with human_grade
  const pairs: Array<{ llm: number; human: number }> = []
  for (const row of sheetRows) {
    if (row.human_grade === '') continue
    const key = `${row.query_id}|${row.brand_slug}|${row.product_key}`
    const llmGrade = llmGrades.get(key)
    if (llmGrade === undefined) continue
    const humanGrade = parseInt(row.human_grade, 10)
    if (Number.isNaN(humanGrade) || humanGrade < 0 || humanGrade > 3) continue
    pairs.push({ llm: llmGrade, human: humanGrade })
  }

  if (pairs.length === 0) {
    console.error('[agreement] No overlapping pairs with human grades found')
    process.exitCode = 1
    return
  }

  console.log(`[agreement] ${pairs.length} overlapping pairs`)

  // Build 4x4 confusion matrix (grades 0-3)
  const matrix = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => 0))
  for (const { llm, human } of pairs) {
    matrix[llm]![human]!++
  }

  // Compute metrics
  const accuracy = pairs.filter(p => p.llm === p.human).length / pairs.length
  const kappa = cohenKappa(matrix)
  const kappaW = cohenKappa(matrix, 'quadratic')

  console.log('\n=== Agreement Report ===')
  console.log(`Pairs: ${pairs.length}`)
  console.log(`Accuracy: ${(accuracy * 100).toFixed(1)}%`)
  console.log(`Cohen's kappa: ${kappa.toFixed(4)}`)
  console.log(`Quadratic-weighted kappa: ${kappaW.toFixed(4)}`)

  // Print confusion matrix
  console.log('\nConfusion matrix (rows=LLM, cols=Human):')
  console.log('     0    1    2    3')
  for (let i = 0; i < 4; i++) {
    const row = matrix[i]!.map(v => String(v).padStart(4)).join(' ')
    console.log(`  ${i} ${row}`)
  }

  // Write agreement.json
  const agreement = {
    timestamp: new Date().toISOString(),
    pairs: pairs.length,
    accuracy,
    kappa,
    kappa_w: kappaW,
    confusionMatrix: matrix,
  }

  writeFileSync(AGREEMENT_PATH, JSON.stringify(agreement, null, 2))
  console.log(`\n[agreement] Wrote ${AGREEMENT_PATH}`)

  if (kappaW < 0.6) {
    console.error(`\n[agreement] FAIL: kappa_w ${kappaW.toFixed(4)} < 0.6 threshold`)
    process.exitCode = 1
  } else {
    console.log(`\n[agreement] PASS: kappa_w ${kappaW.toFixed(4)} >= 0.6 threshold`)
  }
}
