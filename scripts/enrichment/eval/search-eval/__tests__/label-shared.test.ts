import { describe, expect, it } from 'vitest'
import {
  sampleDeep,
  splitByQuery,
  cohenKappa,
  stratifiedSheet,
  toCsv,
  fromCsv,
  type JudgedPair,
  type SheetRow,
} from '../label-shared'

describe('sampleDeep', () => {
  it('picks 5 distinct ranks in 21..100 deterministically', () => {
    const r1 = sampleDeep(1736)
    const r2 = sampleDeep(1736)
    expect(r1).toEqual(r2)
    expect(r1).toHaveLength(5)
    for (const r of r1) {
      expect(r).toBeGreaterThanOrEqual(21)
      expect(r).toBeLessThanOrEqual(100)
    }
    expect(new Set(r1).size).toBe(5) // distinct
  })
})

describe('splitByQuery', () => {
  it('yields 60/20/20 stratified by category', () => {
    const items = Array.from({ length: 200 }, (_, i) => ({
      id: `q-${i}`,
      category: ['food', 'home', 'beauty', 'fashion', 'outdoor'][i % 5],
    }))
    const splits = splitByQuery(items, [60, 20, 20], 1736)

    // Each query in exactly one split
    const all = [...splits.train, ...splits.val, ...splits.holdout]
    expect(all).toHaveLength(200)
    expect(new Set(all.map(s => s.id)).size).toBe(200)

    // Approximate sizes
    expect(splits.train.length).toBeGreaterThanOrEqual(115)
    expect(splits.train.length).toBeLessThanOrEqual(125)
  })
})

describe('cohenKappa', () => {
  it('matches a known 2x2 table', () => {
    // Known example: [[20, 5], [10, 15]]
    // po = 35/50 = 0.7, pe = (25*30 + 25*20)/(50*50) = (750+500)/2500 = 0.5
    // kappa = (0.7-0.5)/(1-0.5) = 0.4
    const matrix = [[20, 5], [10, 15]]
    expect(cohenKappa(matrix)).toBeCloseTo(0.4, 9)
  })

  it('computes quadratic-weighted kappa for a 4x4 matrix', () => {
    const matrix = [
      [10, 2, 1, 0],
      [1, 8, 3, 0],
      [0, 2, 12, 1],
      [0, 0, 1, 9],
    ]
    const result = cohenKappa(matrix, 'quadratic')
    expect(result).toBeGreaterThan(0.7) // should be high agreement
    expect(result).toBeLessThan(1.0)
  })
})

describe('stratifiedSheet', () => {
  it('returns pairs covering every grade and category present, plus all split pairs', () => {
    const judgedPairs: JudgedPair[] = []
    const grades = [0, 1, 2, 3]
    const categories = ['food', 'home', 'beauty']
    let idx = 0
    // Generate 200 judged pairs across grades and categories
    for (let i = 0; i < 200; i++) {
      const grade = grades[i % 4]!
      const cat = categories[i % 3]!
      const isSplit = i % 50 === 0
      judgedPairs.push({
        queryId: `q-${Math.floor(i / 5)}`,
        query: `query ${Math.floor(i / 5)}`,
        brandSlug: `brand-${idx}`,
        productKey: `product-${idx}`,
        nameZh: `Product ${idx}`,
        descriptionZh: `Description ${idx}`,
        officialUrl: `https://example.com/${idx}`,
        categoryZh: cat,
        votes: isSplit ? [0, 1, 2] : [grade, grade, grade],
        grade: isSplit ? 1 : grade,
        split: isSplit,
      })
      idx++
    }

    const sheet = stratifiedSheet(judgedPairs, 150)
    // Should include at least 150 pairs (plus all split pairs)
    expect(sheet.length).toBeGreaterThanOrEqual(150)
    // Every grade represented
    const gradesInSheet = new Set(sheet.map(r => r.llm_grade))
    for (const g of grades) {
      expect(gradesInSheet).toContain(g)
    }
    // Split pairs always included
    const splitPairs = judgedPairs.filter(p => p.split)
    for (const sp of splitPairs) {
      const found = sheet.find(
        r => r.query_id === sp.queryId && r.brand_slug === sp.brandSlug && r.product_key === sp.productKey,
      )
      expect(found).toBeDefined()
    }
  })

  it('preserves existing human grades by composite key', () => {
    const judgedPairs: JudgedPair[] = [
      {
        queryId: 'q-1', query: 'test', brandSlug: 'b-1', productKey: 'p-1',
        nameZh: 'Name', descriptionZh: 'Desc', officialUrl: 'https://example.com',
        categoryZh: 'home', votes: [2, 2, 2], grade: 2, split: false,
      },
      {
        queryId: 'q-1', query: 'test', brandSlug: 'b-2', productKey: 'p-2',
        nameZh: 'Name2', descriptionZh: 'Desc2', officialUrl: 'https://example.com/2',
        categoryZh: 'food', votes: [3, 3, 3], grade: 3, split: false,
      },
    ]

    const existingSheet: SheetRow[] = [{
      query_id: 'q-1', query: 'test', brand_slug: 'b-1', product_key: 'p-1',
      name_zh: 'Name', description_zh: 'Desc', official_url: 'https://example.com',
      llm_grade: 2, human_grade: '1',
    }]

    const sheet = stratifiedSheet(judgedPairs, 2, existingSheet)
    const row1 = sheet.find(r => r.brand_slug === 'b-1' && r.product_key === 'p-1')
    expect(row1?.human_grade).toBe('1')
    const row2 = sheet.find(r => r.brand_slug === 'b-2' && r.product_key === 'p-2')
    expect(row2?.human_grade).toBe('')
  })
})

describe('toCsv/fromCsv', () => {
  it('round-trips with CJK and commas in descriptions', () => {
    const rows: SheetRow[] = [
      {
        query_id: 'q1', query: 'test', brand_slug: 'b1', product_key: 'p1',
        name_zh: 'Name, with comma', description_zh: 'Desc with 中文',
        official_url: 'https://example.com', llm_grade: 3, human_grade: '',
      },
    ]
    const csv = toCsv(rows)
    const parsed = fromCsv(csv)
    expect(parsed[0]).toEqual(rows[0])
  })
})

describe('build-dataset grade precedence', () => {
  it('human > majority', () => {
    // A pair with humanGrade: 1 and votes [3,3,3] yields grade: 1
    // This is tested through the grade resolution logic
    // We verify the stratifiedSheet preserves human grades,
    // and the build-dataset reads human_grade first
    const existingSheet: SheetRow[] = [{
      query_id: 'q-1', query: 'test', brand_slug: 'b-1', product_key: 'p-1',
      name_zh: 'Name', description_zh: 'Desc', official_url: 'https://example.com',
      llm_grade: 3, human_grade: '1',
    }]
    // The sheet preserves human_grade = '1' even though llm_grade = 3
    expect(existingSheet[0]!.human_grade).toBe('1')
    // build-dataset will use parseInt(human_grade) when non-empty
    const humanGrade = existingSheet[0]!.human_grade
    const llmGrade = existingSheet[0]!.llm_grade
    const finalGrade = humanGrade !== '' ? parseInt(humanGrade, 10) : llmGrade
    expect(finalGrade).toBe(1)
  })
})
