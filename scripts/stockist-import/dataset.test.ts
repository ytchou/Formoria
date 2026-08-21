import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseCsvRecords } from '../seo/gsc-404-triage'

const DATASET_DIR = resolve(process.cwd(), 'content/stockists')
const EXPECTED_FILES = [
  'bag-accessories.csv',
  'beauty.csv',
  'crafts.csv',
  'fashion.csv',
  'fitness.csv',
  'food-drink.csv',
  'home.csv',
  'jewelry.csv',
  'kids-pets.csv',
  'outdoor.csv',
  'stationery.csv',
  'tech.csv',
]
const EXPECTED_HEADER = [
  'brand_slug',
  'name',
  'location_type',
  'region_label',
  'address',
  'url',
  'evidence_url',
  'source_type',
  'source_chain',
  'confidence',
  'notes',
]

type DatasetRow = Record<(typeof EXPECTED_HEADER)[number], string>

async function loadDataset(): Promise<{
  headers: string[][]
  rows: DatasetRow[]
}> {
  const files = (await readdir(DATASET_DIR))
    .filter((file) => file.endsWith('.csv'))
    .sort()
  const headers: string[][] = []
  const rows: DatasetRow[] = []

  for (const file of files) {
    const raw = (await readFile(resolve(DATASET_DIR, file), 'utf8')).replace(
      /^\uFEFF/,
      '',
    )
    const [header, ...records] = parseCsvRecords(raw)
    if (!header) throw new Error(`${file}: missing header`)
    headers.push(header)
    for (const record of records) {
      rows.push(
        Object.fromEntries(
          header.map((column, index) => [column, record.at(index) ?? '']),
        ) as DatasetRow,
      )
    }
  }

  return { headers, rows }
}

describe('stockist import dataset', () => {
  /**
   * The header is the contract between the versioned CSVs and
   * `parseStockistCsv`, which rejects any file whose header is not this exact
   * list. The sales-format column was dropped in DEV-1513: every row was
   * offline, so the column carried no information, and a stray twelfth column
   * in one file would fail the whole import rather than silently shift a field.
   * The row and brand totals are asserted here too, so a column edit that also
   * dropped or duplicated rows cannot pass this file alone.
   */
  it('pins the 11-column CSV header across all 12 files', async () => {
    const files = (await readdir(DATASET_DIR))
      .filter((file) => file.endsWith('.csv'))
      .sort()
    const { headers, rows } = await loadDataset()

    expect(EXPECTED_HEADER).toHaveLength(11)
    expect(files).toEqual(EXPECTED_FILES)
    expect(new Set(headers.map((header) => header.join(',')))).toEqual(
      new Set([EXPECTED_HEADER.join(',')]),
    )
    expect(rows).toHaveLength(1_493)
    expect(new Set(rows.map((row) => row.brand_slug)).size).toBe(205)
  })

  it('matches the audited row and brand totals', async () => {
    const { rows } = await loadDataset()

    expect(rows).toHaveLength(1_493)
    expect(new Set(rows.map((row) => row.brand_slug)).size).toBe(205)
  })

  it('contains no row that violates a brand channel constraint', async () => {
    const { rows } = await loadDataset()

    for (const row of rows) {
      expect(row.name.trim().length).toBeGreaterThanOrEqual(1)
      expect(row.name.length).toBeLessThanOrEqual(80)
      expect(row.address.length).toBeLessThanOrEqual(200)
      expect(row.region_label.length).toBeLessThanOrEqual(40)
      if (row.url) expect(row.url).toMatch(/^https?:\/\//i)
      expect(row.evidence_url).toMatch(/^https?:\/\//i)
    }
  })

  it('keeps the three known unmatched slugs visible in the versioned source', async () => {
    const { rows } = await loadDataset()
    const slugs = new Set(rows.map((row) => row.brand_slug))

    expect(
      ['just-herb', 'lin-yuan-mai', 'tint-studio'].filter((slug) =>
        slugs.has(slug),
      ),
    ).toEqual(['just-herb', 'lin-yuan-mai', 'tint-studio'])
  })
})
