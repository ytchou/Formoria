import { describe, expect, it, vi } from 'vitest'

import {
  applyGuard,
  buildDetectItem,
  DENIED_SAMPLE_SEED,
  sampleDenied,
  buildRestorePlan,
  dropExistingIds,
  landedMismatches,
  pacedItemApi,
  parseExport,
  evidenceMetadata,
  isAnchorLeak,
  parseRegenerateArgs,
  parseStoredFields,
  sourceFromStored,
  sourceFromSubmission,
  submissionIdFromSlug,
  uuid5,
  type SubmissionRow,
} from '../regenerate-detect-golden-inputs'

const OLD_FORMAT_USER = [
  '品牌 slug：submission-456c87e9-dd7a-4828-876d-ca4b58acde71',
  '品牌名稱：Design Council Busan',
  '描述：無',
  '網站：https://dcb.or.kr',
  '搜尋摘要：Busan designated World Design Capital — Design Council Busan；SUMIDA MODERN — an initiative',
  '探測：Design Council Busan — official site',
].join('\n')

describe('parseStoredFields', () => {
  it('parse_stored_fields_fallback: recovers name, description and website from an old-format message', () => {
    expect(parseStoredFields(OLD_FORMAT_USER)).toEqual({
      slug: 'submission-456c87e9-dd7a-4828-876d-ca4b58acde71',
      name: 'Design Council Busan',
      description: null,
      website: 'https://dcb.or.kr',
      submittedWebsite: null,
      probeLineCount: 1,
    })
  })

  it('keeps a multi-line description whole and rejects a message with no name', () => {
    const user = '品牌 slug：s\n品牌名稱：A\n描述：line one\nline two\n網站：無'
    expect(parseStoredFields(user)).toMatchObject({ description: 'line one\nline two', website: null, probeLineCount: 0 })
    expect(() => parseStoredFields('品牌 slug：s\n描述：x')).toThrow()
  })
})

const SUBMISSION: SubmissionRow = {
  id: '8d53ef2f-dc4c-4542-9ea6-6c15ee30915d',
  brand_id: null,
  intent: 'new',
  base_brand_data: null,
  brand_name: 'Winten',
  description: 'Cat plush importer',
  website_url: 'https://win10.com.tw',
  hero_image_url: null,
  social_instagram: 'https://www.instagram.com/winten.tw/',
  social_threads: null,
  social_facebook: null,
  other_urls: null,
  enriched_data: null,
  owner_data: null,
  status: 'rejected',
  purchase_website: 'https://shop.win10.com.tw',
  purchase_pinkoi: null,
  purchase_shopee: null,
} as SubmissionRow

const RAW_RESPONSE = {
  organic: [
    { title: 'WINTEN official', link: 'https://win10.com.tw/about', snippet: 'Cat goods', position: 1 },
    { title: 'Winten on IG', link: 'https://www.instagram.com/winten.tw/', position: 2 },
    { title: 'Other WINTEN', link: 'https://example.com/winten', snippet: 'Unrelated', position: 3 },
  ],
}

describe('buildDetectItem', () => {
  it('build_item_from_sources: submission + stored SERP + probes render the production message', () => {
    const { item, rendered } = buildDetectItem({
      source: sourceFromSubmission(SUBMISSION),
      rawResponse: RAW_RESPONSE,
      probeEvidence: [{ url: 'https://win10.com.tw', status: 404 }],
    })

    expect(item.slug).toBe(`submission-${SUBMISSION.id}`)
    expect(item.submittedWebsite).toBe('https://win10.com.tw')
    expect(item.results?.map((r) => r.match)).toEqual(['site', 'instagram', null])
    expect(rendered).toContain('提交網址：https://win10.com.tw')
    expect(rendered).toContain('搜尋結果：WINTEN official — Cat goods（win10.com.tw，官網）')
    expect(rendered).toContain('搜尋結果：Winten on IG（instagram.com，IG 相符）')
    expect(rendered).toContain('搜尋結果：Other WINTEN — Unrelated（example.com）')
    expect(rendered).toContain('探測：win10.com.tw — 無法連線（HTTP 404）')
  })

  it('rebuilds from stored fields when the submission row is missing', () => {
    const { item, rendered } = buildDetectItem({ source: sourceFromStored(parseStoredFields(OLD_FORMAT_USER)), rawResponse: null })
    expect(item.name).toBe('Design Council Busan')
    expect(item.website).toBe('https://dcb.or.kr')
    expect(rendered).toContain('提交網址：無')
  })
})

describe('evidenceMetadata', () => {
  it('evidence_dates_recorded: stored SERP keeps its own date, a live one takes the run date', () => {
    expect(evidenceMetadata({ serpCreatedAt: '2026-08-08T00:41:17Z', runDate: '2026-09-28' })).toEqual({
      evidenceDates: { serp: '2026-08-08T00:41:17Z', probe: '2026-09-28' },
      serpSource: 'stored',
    })
    expect(evidenceMetadata({ serpCreatedAt: null, runDate: '2026-09-28' })).toEqual({
      evidenceDates: { serp: '2026-09-28', probe: '2026-09-28' },
      serpSource: 'live',
    })
  })
})

describe('submissionIdFromSlug', () => {
  it('reads the submission id a provisional slug carries', () => {
    expect(submissionIdFromSlug('submission-bc4ff848-8129-4bb2-b665-a33453796666')).toBe(
      'bc4ff848-8129-4bb2-b665-a33453796666',
    )
    expect(submissionIdFromSlug('SUBMISSION-BC4FF848-8129-4BB2-B665-A33453796666')).toBe(
      'bc4ff848-8129-4bb2-b665-a33453796666',
    )
  })

  it('returns null for a brand slug or a malformed id', () => {
    expect(submissionIdFromSlug('iwi-writing')).toBeNull()
    expect(submissionIdFromSlug('submission-not-a-uuid')).toBeNull()
    expect(submissionIdFromSlug('x-submission-bc4ff848-8129-4bb2-b665-a33453796666')).toBeNull()
  })
})

describe('sampleDenied', () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({ id: `id-${String(i).padStart(3, '0')}` }))

  it('takes a deterministic seeded sample of n, independent of input order', () => {
    const first = sampleDenied(rows, 60, DENIED_SAMPLE_SEED)
    expect(first).toHaveLength(60)
    expect(new Set(first.map((row) => row.id)).size).toBe(60)
    expect(sampleDenied([...rows].reverse(), 60, DENIED_SAMPLE_SEED)).toEqual(first)
    expect(sampleDenied(rows, 60, 'other-seed')).not.toEqual(first)
  })

  it('keeps every row when n is null or at least the pool size', () => {
    expect(sampleDenied(rows, null, DENIED_SAMPLE_SEED)).toHaveLength(200)
    expect(sampleDenied(rows.slice(0, 5), 60, DENIED_SAMPLE_SEED)).toHaveLength(5)
  })
})

describe('isAnchorLeak', () => {
  it('anchor_leak_check_rejects: names matching a prompt golden anchor are rejected', () => {
    expect(isAnchorLeak('好物嚴選')).toBe(true)
    expect(isAnchorLeak(' 島嶼紙品 ')).toBe(true)
    expect(isAnchorLeak('某某工作室 Studio')).toBe(true)
    expect(isAnchorLeak('Design Council Busan')).toBe(false)
  })
})

describe('applyGuard', () => {
  it('apply_refuses_over_10pct_failures: 3 of 20 failing refuses, 2 of 20 passes', () => {
    expect(applyGuard({ total: 20, failed: 3 }).ok).toBe(false)
    expect(applyGuard({ total: 20, failed: 2 }).ok).toBe(true)
    expect(applyGuard({ total: 0, failed: 0 }).ok).toBe(false)
  })
})

describe('parseRegenerateArgs', () => {
  it('parses --denied-sample, which needs --add-denied and a positive integer', () => {
    expect(parseRegenerateArgs(['--add-denied', '--denied-sample', '60']).deniedSample).toBe(60)
    expect(parseRegenerateArgs([]).deniedSample).toBeNull()
    expect(() => parseRegenerateArgs(['--denied-sample', '60'])).toThrow(/--add-denied/)
    expect(() => parseRegenerateArgs(['--add-denied', '--denied-sample', '0'])).toThrow(/positive integer/)
  })

  it('apply_requires_pre_export: --apply without --pre-export is rejected', () => {
    expect(() => parseRegenerateArgs(['--apply'])).toThrow(/--pre-export/)
    expect(parseRegenerateArgs(['--apply', '--pre-export', '/tmp/x.json'])).toMatchObject({
      apply: true,
      preExport: '/tmp/x.json',
    })
  })

  it('defaults to a dry run printing 10 diffs', () => {
    expect(parseRegenerateArgs([])).toEqual({
      apply: false,
      preExport: null,
      restore: null,
      addDenied: false,
      assignSplits: false,
      diffs: 10,
      deniedSample: null,
    })
    expect(parseRegenerateArgs(['--add-denied', '--assign-splits', '--diffs', '3'])).toMatchObject({
      addDenied: true,
      assignSplits: true,
      diffs: 3,
    })
  })
})

describe('parseRegenerateArgs --restore', () => {
  it('parses --restore as a dry run, --apply writes without --pre-export', () => {
    expect(parseRegenerateArgs(['--restore', 'rebuild/pre-export.json'])).toMatchObject({
      restore: 'rebuild/pre-export.json',
      apply: false,
    })
    expect(parseRegenerateArgs(['--restore', 'rebuild/pre-export.json', '--apply'])).toMatchObject({
      restore: 'rebuild/pre-export.json',
      apply: true,
      preExport: null,
    })
  })

  it('rejects --restore combined with a rebuild flag', () => {
    expect(() => parseRegenerateArgs(['--restore', 'x.json', '--add-denied'])).toThrow(/--restore/)
    expect(() => parseRegenerateArgs(['--restore', 'x.json', '--assign-splits'])).toThrow(/--restore/)
    expect(() => parseRegenerateArgs(['--restore', 'x.json', '--pre-export', 'y.json'])).toThrow(/--restore/)
  })
})

const body = (id: string, user: string, status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE') => ({
  datasetName: 'detect-confidence-golden',
  id,
  input: { user, promptName: 'detect' },
  expectedOutput: { isNonBrand: false, confidence: 'high' },
  metadata: { split: 'train', humanApproval: { status: 'pending' } },
  status,
})

describe('landedMismatches', () => {
  it('passes when every id landed with the written fields, whatever the key order', () => {
    const expected = [body('a', 'new a')]
    const stored = new Map<string, unknown>([
      [
        'a',
        {
          id: 'a',
          status: 'ACTIVE',
          metadata: { humanApproval: { status: 'pending' }, split: 'train' },
          expectedOutput: { confidence: 'high', isNonBrand: false },
          input: { promptName: 'detect', user: 'new a' },
          createdAt: '2026-09-28',
        },
      ],
    ])
    expect(landedMismatches(expected, stored)).toEqual([])
  })

  it('reports a missing id, a stale input and a wrong status', () => {
    const expected = [body('a', 'new a'), body('b', 'new b'), body('c', 'c', 'ARCHIVED')]
    const stored = new Map<string, unknown>([
      ['b', { ...body('b', 'old b') }],
      ['c', { ...body('c', 'c', 'ACTIVE') }],
    ])
    expect(landedMismatches(expected, stored)).toEqual([
      { id: 'a', reason: 'not found' },
      { id: 'b', reason: 'input differs' },
      { id: 'c', reason: 'status ACTIVE, expected ARCHIVED' },
    ])
  })
})

describe('dropExistingIds', () => {
  it('skips a denied item whose uuid5 id already exists in any status', () => {
    const upserts = [{ id: 'new' }, { id: 'archived' }]
    expect(dropExistingIds(upserts, new Set(['archived']))).toEqual({ kept: [{ id: 'new' }], skipped: ['archived'] })
  })
})

describe('buildRestorePlan', () => {
  const exported = [
    { id: 'a', status: 'ACTIVE', input: { user: 'old a' }, expectedOutput: { isNonBrand: true }, metadata: { split: 'val' } },
    { id: 'b', input: { user: 'old b' }, expectedOutput: null, metadata: {} },
  ]

  it('upserts every exported item and archives admin-denied items the export lacks', () => {
    const current = [
      { id: 'a', status: 'ACTIVE', input: { user: 'new a' }, expectedOutput: null, metadata: {} },
      { id: 'd1', status: 'ACTIVE', input: { user: 'denied' }, expectedOutput: null, metadata: { stratum: 'admin-denied' } },
      { id: 'x', status: 'ACTIVE', input: { user: 'other' }, expectedOutput: null, metadata: { stratum: 'nonbrand' } },
    ]
    const plan = buildRestorePlan('detect-confidence-golden', parseExport(exported), current)
    expect(plan.restores).toEqual([
      { datasetName: 'detect-confidence-golden', id: 'a', status: 'ACTIVE', input: { user: 'old a' }, expectedOutput: { isNonBrand: true }, metadata: { split: 'val' } },
      { datasetName: 'detect-confidence-golden', id: 'b', status: 'ACTIVE', input: { user: 'old b' }, expectedOutput: null, metadata: {} },
    ])
    expect(plan.archives).toEqual([
      { datasetName: 'detect-confidence-golden', id: 'd1', status: 'ARCHIVED', input: { user: 'denied' }, expectedOutput: null, metadata: { stratum: 'admin-denied' } },
    ])
  })

  it('parseExport rejects a file that is not an item export', () => {
    expect(() => parseExport({ items: [] })).toThrow(/array/)
    expect(() => parseExport([{ input: {} }])).toThrow(/id/)
    expect(() => parseExport([{ id: 'a', status: 'DELETED', input: {} }])).toThrow(/status/)
  })
})

describe('pacedItemApi', () => {
  const noSleep = () => vi.fn(async (_ms: number) => {})

  it('write retries a create that resolves without the id (the SDK swallows a 429)', async () => {
    const sleep = noSleep()
    const createItem = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: 'a' })
    const api = pacedItemApi({ createItem, getItem: vi.fn() }, { sleep })
    expect(await api.write(body('a', 'x'))).toBe(true)
    expect(createItem).toHaveBeenCalledTimes(2)
  })

  it('write reports false when Langfuse never confirms the id', async () => {
    const api = pacedItemApi({ createItem: vi.fn().mockResolvedValue(undefined), getItem: vi.fn() }, { sleep: noSleep() })
    expect(await api.write(body('a', 'x'))).toBe(false)
  })

  it('paces consecutive calls', async () => {
    const sleep = noSleep()
    const api = pacedItemApi({ createItem: vi.fn(async (b: { id: string }) => ({ id: b.id })), getItem: vi.fn() }, { sleep })
    await api.write(body('a', 'x'))
    await api.write(body('b', 'x'))
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(700)
  })

  it('lookup: 404 is absent, an ARCHIVED item is present, a 429 is retried, other errors throw', async () => {
    const archived = { id: 'b', status: 'ARCHIVED' }
    const getItem = vi.fn(async (id: string) => {
      if (id === 'a') throw { status: 404 }
      if (id === 'b') return archived
      throw { status: 500 }
    })
    const api = pacedItemApi({ createItem: vi.fn(), getItem }, { sleep: noSleep() })
    expect(await api.lookup('a')).toEqual({ present: false })
    expect(await api.lookup('b')).toEqual({ present: true, stored: archived })
    await expect(api.lookup('c')).rejects.toMatchObject({ status: 500 })

    const limited = vi.fn().mockRejectedValueOnce({ status: 429 }).mockResolvedValueOnce(archived)
    const retrying = pacedItemApi({ createItem: vi.fn(), getItem: limited }, { sleep: noSleep() })
    expect(await retrying.lookup('b')).toEqual({ present: true, stored: archived })
  })
})

describe('uuid5', () => {
  it('matches Python uuid.uuid5(NAMESPACE_URL, name), the id scheme the existing items use', () => {
    expect(uuid5('detect-golden:8ce1123d-7f47-4844-b5a2-f523933fa9dc')).toBe('70ea9d76-bfb4-524a-ba4e-4314fc12090f')
  })
})
