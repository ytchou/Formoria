import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseStockistCsv, type StockistCsvRow } from './normalize'
import { planStockistImport, type ApprovedBrand } from './plan'

function row(overrides: Partial<StockistCsvRow> = {}): StockistCsvRow {
  return {
    brand_slug: 'hanchor',
    name: '登山友',
    location_type: 'stockist',
    channel_type: 'offline',
    category_label: 'outdoor',
    region_label: '臺北市',
    address: '臺北市中正區中山北路一段18號',
    url: '',
    evidence_url: 'https://hanchor.com.tw/pages/stockists',
    source_type: 'official_website',
    source_chain: 'brand stockist directory',
    confidence: 'high',
    notes: '',
    ...overrides,
  }
}

function brands(...slugs: string[]): ApprovedBrand[] {
  return slugs.map((slug) => ({ id: `approved-${slug}`, slug }))
}

describe('stockist import planning', () => {
  it('collapses a within-brand collision in one region and preserves one across regions', () => {
    const plan = planStockistImport(
      [
        row(),
        row({ address: '臺北市中正區中山北路一段20號' }),
        row({
          brand_slug: '2bm',
          name: '勝立商行',
          region_label: '臺北市',
          address: '臺北市內湖區內湖路一段372號',
        }),
        row({
          brand_slug: '2bm',
          name: '勝立商行',
          region_label: '新北市',
          address: '新北市板橋區南雅東路8號1樓',
        }),
      ],
      brands('hanchor', '2bm'),
    )

    expect(
      plan.brands.find((brand) => brand.brandSlug === 'hanchor')?.candidates,
    ).toHaveLength(1)
    expect(
      plan.brands.find((brand) => brand.brandSlug === '2bm')?.candidates,
    ).toHaveLength(2)
    expect(plan.totals.collapsed).toBe(1)
  })

  it('keeps region-suffixed normalized names inside the database limit', () => {
    const longName = '臺灣戶外生活用品專門選物中心旗艦門市'.repeat(5)
    const plan = planStockistImport(
      [
        row({ name: longName, region_label: '臺北市' }),
        row({ name: longName, region_label: '新北市' }),
      ],
      brands('hanchor'),
    )

    expect(
      plan.brands
        .flatMap((brand) => brand.candidates)
        .every((candidate) => candidate.normalizedName.length <= 80),
    ).toBe(true)
  })

  it('routes by official website source rather than confidence', () => {
    const plan = planStockistImport(
      [
        row({ confidence: 'medium' }),
        row({
          name: '城市綠洲台北店',
          source_type: 'retailer_website',
          confidence: 'high',
        }),
      ],
      brands('hanchor'),
    )

    expect(plan.totals).toMatchObject({ publish: 1, heldBack: 1 })
  })

  it('reconciles the audited dataset totals and unmatched slugs', async () => {
    const directory = resolve(process.cwd(), 'content/stockists')
    const datasets = await Promise.all(
      (await readdir(directory))
        .filter((file) => file.endsWith('.csv'))
        .map(async (file) =>
          parseStockistCsv(
            await readFile(resolve(directory, file), 'utf8'),
            file,
          ),
        ),
    )
    const rows = datasets.flat()
    const unmatched = new Set(['just-herb', 'lin-yuan-mai', 'tint-studio'])
    const approvedSlugs = [
      ...new Set(rows.map((item) => item.brand_slug)),
    ].filter((slug) => !unmatched.has(slug))
    const plan = planStockistImport(rows, brands(...approvedSlugs))

    expect(plan.unmatchedSlugs).toEqual([...unmatched].sort())
    expect(plan.totals).toEqual({
      publish: 1_356,
      upserts: 1_354,
      heldBack: 103,
      unmatched: 34,
      collapsed: 2,
      rejected: 0,
    })
  })
})
