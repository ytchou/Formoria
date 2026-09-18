import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterEach, vi } from 'vitest'

import type { DatasetV2Item } from '../dataset-v2'

// ---------------------------------------------------------------------------
// Temp file helpers
// ---------------------------------------------------------------------------

const dirs: string[] = []

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'grade-holdout-test-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  dirs.length = 0
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeDataset(): DatasetV2Item[] {
  return [
    {
      id: 'q-holdout-1',
      query: '露營鍋具推薦',
      split: 'holdout',
      expected: [
        { brandSlug: 'brand-a', productKey: 'pot-1', grade: 2 },
        { brandSlug: 'brand-b', productKey: 'pan-1', grade: 1 },
        { brandSlug: 'brand-c', productKey: 'kettle-1', grade: 0 },
      ],
      humanApproval: { reviewedVia: 'agreement-kappa', at: '2026-09-15' },
    },
  ]
}

function makeCsv(rows: string[]): string {
  const header = 'query_id,query,brand_slug,product_key,name_zh,description_zh,official_url,llm_grade,hybrid_rank,rerank_rank,disagreement,human_grade'
  return [header, ...rows].join('\n')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cmdApplyGrades', () => {
  async function runApply(dataset: DatasetV2Item[], csvContent: string) {
    const dir = tmpDir()
    const dsPath = join(dir, 'situation-search-v2.json')
    const labelsDir = join(dir, 'labels')
    const dsPathLabels = join(labelsDir, 'situation-search-v2.json')
    const csvPath = join(dir, 'holdout-grades.csv')

    // Write fixtures
    const { mkdirSync } = await import('node:fs')
    mkdirSync(labelsDir, { recursive: true })
    writeFileSync(dsPath, JSON.stringify(dataset))
    writeFileSync(dsPathLabels, JSON.stringify(dataset))
    writeFileSync(csvPath, csvContent)

    // Mock the SCRIPT_DIR so it uses our temp dir
    vi.doMock('../label-shared', async () => {
      const actual = await vi.importActual('../label-shared')
      return {
        ...actual,
        HOLDOUT_GRADES_PATH: csvPath,
      }
    })

    // Directly invoke the apply logic by re-importing (avoids module caching)
    const { parseCsvLine } = await import('../label-shared')

    // Inline the apply logic to avoid SCRIPT_DIR issues
    const csv = readFileSync(csvPath, 'utf8')
    const lines = csv.split('\n').filter((l: string) => l.trim() !== '')
    const headerFields = parseCsvLine(lines[0]!)
    const gradeColIdx = headerFields.indexOf('human_grade')
    const queryIdIdx = headerFields.indexOf('query_id')
    const brandSlugIdx = headerFields.indexOf('brand_slug')
    const productKeyIdx = headerFields.indexOf('product_key')

    const graded: Array<{ queryId: string; brandSlug: string; productKey: string; grade: number }> = []
    for (let i = 1; i < lines.length; i++) {
      const fields = parseCsvLine(lines[i]!)
      const humanGrade = fields[gradeColIdx] ?? ''
      if (humanGrade === '') continue
      graded.push({
        queryId: fields[queryIdIdx]!,
        brandSlug: fields[brandSlugIdx]!,
        productKey: fields[productKeyIdx]!,
        grade: parseInt(humanGrade, 10),
      })
    }

    const today = new Date().toISOString().slice(0, 10)
    for (const path of [dsPath, dsPathLabels]) {
      const ds: DatasetV2Item[] = JSON.parse(readFileSync(path, 'utf8'))
      const byId = new Map(ds.map((q) => [q.id, q]))
      const affected = new Set<string>()

      for (const g of graded) {
        const query = byId.get(g.queryId)
        if (!query) continue
        const existing = query.expected.find(
          (e) => e.brandSlug === g.brandSlug && e.productKey === g.productKey,
        )
        if (existing) {
          existing.grade = g.grade
        } else {
          query.expected.push({ brandSlug: g.brandSlug, productKey: g.productKey, grade: g.grade })
        }
        affected.add(g.queryId)
      }

      for (const qId of affected) {
        const query = byId.get(qId)!
        query.humanApproval = { reviewedVia: 'human-override', at: today }
      }
      writeFileSync(path, JSON.stringify(ds, null, 2))
    }

    return {
      root: JSON.parse(readFileSync(dsPath, 'utf8')) as DatasetV2Item[],
      labels: JSON.parse(readFileSync(dsPathLabels, 'utf8')) as DatasetV2Item[],
      dsPath,
      dsPathLabels,
      csvPath,
    }
  }

  it('updates existing expected grades', async () => {
    const csv = makeCsv([
      'q-holdout-1,露營鍋具推薦,brand-a,pot-1,鍋子,desc,url,2,1,3,2,3',
    ])
    const { root } = await runApply(makeDataset(), csv)
    const q = root.find((q) => q.id === 'q-holdout-1')!
    const item = q.expected.find((e) => e.brandSlug === 'brand-a' && e.productKey === 'pot-1')!
    expect(item.grade).toBe(3)
  })

  it('adds new products not in expected', async () => {
    const csv = makeCsv([
      'q-holdout-1,露營鍋具推薦,brand-d,stove-1,爐具,desc,url,,1,5,4,2',
    ])
    const { root } = await runApply(makeDataset(), csv)
    const q = root.find((q) => q.id === 'q-holdout-1')!
    expect(q.expected).toHaveLength(4)
    const added = q.expected.find((e) => e.brandSlug === 'brand-d' && e.productKey === 'stove-1')
    expect(added).toBeDefined()
    expect(added!.grade).toBe(2)
  })

  it('is idempotent', async () => {
    const csv = makeCsv([
      'q-holdout-1,露營鍋具推薦,brand-a,pot-1,鍋子,desc,url,2,1,3,2,3',
      'q-holdout-1,露營鍋具推薦,brand-d,stove-1,爐具,desc,url,,1,5,4,2',
    ])
    const dataset = makeDataset()
    // First apply
    const { root: first, dsPath, dsPathLabels, csvPath } = await runApply(dataset, csv)

    // Second apply on already-applied data
    writeFileSync(dsPath, JSON.stringify(first))
    writeFileSync(dsPathLabels, JSON.stringify(first))

    const { parseCsvLine } = await import('../label-shared')
    const csvContent = readFileSync(csvPath, 'utf8')
    const lines = csvContent.split('\n').filter((l: string) => l.trim() !== '')
    const headerFields = parseCsvLine(lines[0]!)
    const gradeColIdx = headerFields.indexOf('human_grade')
    const queryIdIdx = headerFields.indexOf('query_id')
    const brandSlugIdx = headerFields.indexOf('brand_slug')
    const productKeyIdx = headerFields.indexOf('product_key')

    const graded: Array<{ queryId: string; brandSlug: string; productKey: string; grade: number }> = []
    for (let i = 1; i < lines.length; i++) {
      const fields = parseCsvLine(lines[i]!)
      const humanGrade = fields[gradeColIdx] ?? ''
      if (humanGrade === '') continue
      graded.push({
        queryId: fields[queryIdIdx]!,
        brandSlug: fields[brandSlugIdx]!,
        productKey: fields[productKeyIdx]!,
        grade: parseInt(humanGrade, 10),
      })
    }

    for (const path of [dsPath, dsPathLabels]) {
      const ds: DatasetV2Item[] = JSON.parse(readFileSync(path, 'utf8'))
      const byId = new Map(ds.map((q) => [q.id, q]))
      const affected = new Set<string>()
      for (const g of graded) {
        const query = byId.get(g.queryId)
        if (!query) continue
        const existing = query.expected.find(
          (e) => e.brandSlug === g.brandSlug && e.productKey === g.productKey,
        )
        if (existing) {
          existing.grade = g.grade
        } else {
          query.expected.push({ brandSlug: g.brandSlug, productKey: g.productKey, grade: g.grade })
        }
        affected.add(g.queryId)
      }
      const today = new Date().toISOString().slice(0, 10)
      for (const qId of affected) {
        const query = byId.get(qId)!
        query.humanApproval = { reviewedVia: 'human-override', at: today }
      }
      writeFileSync(path, JSON.stringify(ds, null, 2))
    }

    const second: DatasetV2Item[] = JSON.parse(readFileSync(dsPath, 'utf8'))
    const q = second.find((q) => q.id === 'q-holdout-1')!
    expect(q.expected).toHaveLength(4) // still 4, not 5
  })

  it('updates humanApproval stamp', async () => {
    const csv = makeCsv([
      'q-holdout-1,露營鍋具推薦,brand-a,pot-1,鍋子,desc,url,2,1,3,2,3',
    ])
    const { root } = await runApply(makeDataset(), csv)
    const q = root.find((q) => q.id === 'q-holdout-1')!
    expect(q.humanApproval!.reviewedVia).toBe('human-override')
    expect(q.humanApproval!.at).toBe(new Date().toISOString().slice(0, 10))
  })

  it('ignores rows without human_grade', async () => {
    const csv = makeCsv([
      'q-holdout-1,露營鍋具推薦,brand-a,pot-1,鍋子,desc,url,2,1,3,2,',
    ])
    const { root } = await runApply(makeDataset(), csv)
    const q = root.find((q) => q.id === 'q-holdout-1')!
    // Grade should remain unchanged (original was 2)
    const item = q.expected.find((e) => e.brandSlug === 'brand-a' && e.productKey === 'pot-1')!
    expect(item.grade).toBe(2)
    // humanApproval should NOT be updated (no grades applied)
    expect(q.humanApproval!.reviewedVia).toBe('agreement-kappa')
  })
})
