import { describe, expect, it } from 'vitest'

import { snapshotPrompt } from '@/lib/langfuse/prompt'
import { normalizeCandidates } from '@/lib/services/enrich-phases/names'
import { MAX_PROMPT_LENGTH, PROMPT_TRUNCATION_MARK } from '@/lib/services/llm-audit'
import { buildNameArbiterUserContent, type NameCandidate } from '@/lib/services/name-arbiter'
import {
  applyPool,
  assignSplits,
  blindItems,
  buildPool,
  extractItemLines,
  hardTagsFor,
  harvestRows,
  isPromptLeak,
  promptLeakStrings,
  type ExistingItem,
  type HarvestRow,
  type HarvestWriter,
  type PoolItem,
} from '../harvest-name-arbiter-golden'

const HEADER = buildNameArbiterUserContent([]).split('\n')[0]!

/** One production-formatted item line, numbered `index`. */
function line(slug: string, storedName: string, candidates: NameCandidate[], index = 1): string {
  const rendered = buildNameArbiterUserContent([
    { slug, storedName, candidates: normalizeCandidates(storedName, candidates) },
  ]).split('\n')[1]!
  return rendered.replace(/^1\./, `${index}.`)
}

function user(lines: string[]): string {
  return [HEADER, ...lines].join('\n')
}

function row(id: string, createdAt: string, lines: string[]): HarvestRow {
  return { id, created_at: createdAt, input: { user: user(lines) } }
}

function existingItem(id: string, slug: string, storedName: string, candidates: NameCandidate[], metadata: Record<string, unknown> = {}): ExistingItem {
  return {
    id,
    input: {
      user: buildNameArbiterUserContent([{ slug, storedName, candidates: normalizeCandidates(storedName, candidates) }]),
      promptName: 'name-arbiter',
    },
    expectedOutput: { acceptedNames: [storedName], confidence: 'high' },
    status: 'ACTIVE',
    metadata,
  }
}

const cleaned = (value: string): NameCandidate => ({ source: 'cleaned', value })
const leaks = promptLeakStrings(snapshotPrompt('name-arbiter').text)

describe('harvest-name-arbiter-golden', () => {
  it('extracts intact item lines and drops the last line of a truncated user message', () => {
    const lines = [
      line('submission-a', 'Alpha Studio', [cleaned('Alpha')], 1),
      line('submission-b', 'Beta Works', [cleaned('Beta')], 2),
      line('submission-c', 'Gamma Goods', [cleaned('Gamma')], 3),
    ]

    expect(extractItemLines(user(lines))).toEqual({ lines, truncated: false })

    // llm-audit cuts at MAX_PROMPT_LENGTH and appends the mark; only that exact shape is truncated.
    const many = Array.from({ length: 60 }, (_, i) => line(`submission-${i}`, `Brand Number ${i}`, [cleaned(`Number ${i}`)], i + 1))
    const full = user(many)
    expect(full.length).toBeGreaterThan(MAX_PROMPT_LENGTH)
    const cut = `${full.slice(0, MAX_PROMPT_LENGTH)}${PROMPT_TRUNCATION_MARK}`
    const intact = many.filter((l) => full.indexOf(l) + l.length < MAX_PROMPT_LENGTH)
    expect(intact.length).toBeGreaterThan(0)
    expect(intact.length).toBeLessThan(many.length)
    expect(extractItemLines(cut)).toEqual({ lines: intact, truncated: true })
  })

  it('keeps the last line of a short complete message whose last snippet ends in the truncation mark', () => {
    const first = line('submission-a', 'Alpha Studio', [cleaned('Alpha')], 1)
    const last = buildNameArbiterUserContent([
      {
        slug: 'submission-b',
        storedName: 'Beta Works',
        candidates: normalizeCandidates('Beta Works', [cleaned('Beta')]),
        snippets: ['Beta Works makes wooden toys', `Handmade in Tainan${PROMPT_TRUNCATION_MARK}`],
      },
    ]).split('\n')[1]!.replace(/^1\./, '2.')
    const complete = user([first, last])
    expect(complete.endsWith(PROMPT_TRUNCATION_MARK)).toBe(true)

    expect(extractItemLines(complete)).toEqual({ lines: [first, last], truncated: false })
  })

  it('re-renders each line through normalizeCandidates + buildNameArbiterUserContent and skips lines that do not round-trip', () => {
    const good = line('submission-good', 'Good Brand', [cleaned('Good')], 1)
    // The normalizer collapses the double space, so the re-rendered line differs.
    const drifted = '2. [submission-drift] 儲存名稱：Drift  Brand / 候選：stored：Drift  Brand；cleaned：Drift'
    const unparseable = '3. [submission-bad] 儲存名稱：Bad Brand'

    const { items, stats } = harvestRows([row('row-1', '2026-09-01T00:00:00Z', [good, drifted, unparseable])])

    expect(items.map((item) => item.slug)).toEqual(['submission-good'])
    expect(items[0]!.user).toBe(user([good]))
    expect(items[0]!.sourceRowId).toBe('row-1')
    expect(stats).toMatchObject({ rows: 1, intactLines: 3, skipped: 2, tooFew: 0 })
  })

  it('drops items with fewer than two distinct candidates', () => {
    const single = line('submission-single', 'Solo Brand', [cleaned('Solo Brand')], 1)
    const pair = line('submission-pair', 'Pair Brand', [cleaned('Pair')], 2)

    const { items, stats } = harvestRows([row('row-1', '2026-09-01T00:00:00Z', [single, pair])])

    expect(items.map((item) => item.slug)).toEqual(['submission-pair'])
    expect(stats).toMatchObject({ intactLines: 2, skipped: 0, tooFew: 1 })
  })

  it('tags trailing-segment, bilingual-half and capitalisation', () => {
    expect(hardTagsFor(['Aromase Scalp Care', 'Aromase'])).toEqual(['trailing-segment'])
    expect(hardTagsFor(['沃廚 WOKY', 'WOKY'])).toEqual(['bilingual-half'])
    expect(hardTagsFor(['qn dessert', 'QN DESSERT'])).toEqual(['capitalisation'])
    expect(hardTagsFor(['Trista Handmade', 'Smile Girl'])).toEqual([])
  })

  it('pins items matching any name-arbiter prompt string to train', () => {
    // Every 「…」 quote, minus the page-chrome words the prompt tells the model to remove.
    expect(leaks).toContain('藺草工坊')
    expect(leaks).toContain('故事鞋與童畫包')
    expect(leaks).not.toContain('首頁')
    // Candidate values of the four golden anchors.
    expect(leaks).toEqual(expect.arrayContaining(['UNIGAZE', 'Trista Smile Girl 微笑女孩', 'AROMASE 艾瑪絲', 'LID Shoes']))

    expect(isPromptLeak(['藺草工坊 Rush Studio', 'Rush Studio'], leaks)).toBe(true)
    expect(isPromptLeak(['trista smile girl 微笑女孩', 'Other'], leaks)).toBe(true)
    expect(isPromptLeak(['Plain Brand', 'Plain'], leaks)).toBe(false)

    const { items } = harvestRows([
      row('row-1', '2026-09-01T00:00:00Z', [
        line('submission-quote', '藺草工坊 Rush Studio', [cleaned('Rush Studio')], 1),
        line('submission-anchor', 'Trista Smile Girl 微笑女孩', [cleaned('Trista')], 2),
        ...Array.from({ length: 10 }, (_, i) => line(`submission-plain-${i}`, `Plain Brand ${i}`, [cleaned(`Other ${i}`)], i + 3)),
      ]),
    ])
    const { pool } = buildPool({
      existing: [existingItem('name-golden-mu-ran', 'mu-ran', 'Mu Ran Dessert', [cleaned('Mu Ran')])],
      harvested: items,
      leakStrings: leaks,
    })
    const split = assignSplits(pool, 'seed-a')
    const byId = new Map(split.map((item) => [item.id, item]))

    for (const id of ['names-submission-quote', 'names-submission-anchor', 'name-golden-mu-ran']) {
      expect(byId.get(id)).toMatchObject({ pinned: true, split: 'train' })
    }
    expect(split.filter((item) => !item.pinned).map((item) => item.split)).toContain('holdout')
  })

  it('assigns 60/20/20 splits stratified by tag, deterministic for a seed', () => {
    const base: PoolItem[] = [
      ...Array.from({ length: 50 }, (_, i) => poolItem(`names-plain-${i}`, [])),
      ...Array.from({ length: 10 }, (_, i) => poolItem(`names-case-${i}`, ['capitalisation'])),
    ]

    const first = assignSplits(base, 'seed-a')
    const count = (items: PoolItem[], tag: string | null, split: string) =>
      items.filter((item) => (tag ? item.hardTags.includes(tag as never) : item.hardTags.length === 0) && item.split === split).length

    expect([count(first, null, 'train'), count(first, null, 'val'), count(first, null, 'holdout')]).toEqual([30, 10, 10])
    expect([count(first, 'capitalisation', 'train'), count(first, 'capitalisation', 'val'), count(first, 'capitalisation', 'holdout')]).toEqual([6, 2, 2])

    const splitsOf = (items: PoolItem[]) => Object.fromEntries(items.map((item) => [item.id, item.split]))
    expect(splitsOf(assignSplits([...base].reverse(), 'seed-a'))).toEqual(splitsOf(first))
    expect(splitsOf(assignSplits(base, 'seed-b'))).not.toEqual(splitsOf(first))
  })

  it('continues the 3/1/1 pattern after the items that already have a split', () => {
    // Three split items fill positions 0-2 (train, train, train); the next two positions are val and holdout.
    const pool: PoolItem[] = [
      { ...poolItem('names-old-0', []), split: 'train' },
      { ...poolItem('names-old-1', []), split: 'val' },
      { ...poolItem('names-old-2', []), split: 'holdout' },
      { ...poolItem('names-pinned', []), pinned: true, split: 'train' },
      poolItem('names-new-0', []),
      poolItem('names-new-1', []),
    ]

    const split = assignSplits(pool, 'seed-a')
    const byId = new Map(split.map((item) => [item.id, item.split]))

    expect(['names-old-0', 'names-old-1', 'names-old-2'].map((id) => byId.get(id))).toEqual(['train', 'val', 'holdout'])
    expect([byId.get('names-new-0'), byId.get('names-new-1')].sort()).toEqual(['holdout', 'val'])
  })

  it('dedupes by slug and by normalized stored name, keeping existing dataset ids', () => {
    const { items } = harvestRows([
      row('row-old', '2026-08-01T00:00:00Z', [line('submission-late', 'Late Brand', [cleaned('Late')], 1)]),
      row('row-new', '2026-09-10T00:00:00Z', [
        line('existing-slug', 'Renamed Brand', [cleaned('Renamed')], 1),
        line('submission-same-name', 'foo  brand', [cleaned('Foo')], 2),
        line('submission-late', 'Late Brand', [cleaned('Late B')], 3),
      ]),
    ])
    const { pool, duplicates } = buildPool({
      existing: [
        existingItem('name-golden-existing', 'existing-slug', 'Existing Brand', [cleaned('Existing')]),
        existingItem('name-golden-foo', 'foo', 'Foo Brand', [cleaned('Foo')]),
        existingItem('name-golden-foo-variant', 'foo-variant', 'Foo Brand', [cleaned('Foo Shop')]),
      ],
      harvested: items,
      leakStrings: leaks,
    })

    expect(pool.map((item) => item.id)).toEqual([
      'name-golden-existing',
      'name-golden-foo',
      'name-golden-foo-variant',
      'names-submission-late',
    ])
    expect(pool.find((item) => item.id === 'names-submission-late')?.sourceRowId).toBe('row-new')
    expect(duplicates).toBe(3)
    expect(blindItems(pool)).toEqual(pool.map((item) => ({ id: item.id, user: item.user })))
  })

  it('apply merges metadata and skips items that already have humanApproval.reviewedVia', async () => {
    const reviewedVia = { queueId: null, scoreId: 'score-1' }
    const existing = [
      existingItem('name-golden-open', 'open-brand', 'Open Brand', [cleaned('Open')], { note: 'keep me' }),
      existingItem('name-golden-done', 'done-brand', 'Done Brand', [cleaned('Done')], { split: 'val', humanApproval: { status: 'approved', reviewedVia } }),
      existingItem('name-golden-unsplit', 'unsplit-brand', 'Unsplit Brand', [cleaned('Unsplit')], { humanApproval: { status: 'approved', reviewedVia } }),
    ]
    const { items } = harvestRows([row('row-9', '2026-09-01T00:00:00Z', [line('submission-new', 'New Brand', [cleaned('New')], 1)])])
    const pool = assignSplits(buildPool({ existing, harvested: items, leakStrings: leaks }).pool, 'seed-a')

    const store = new Map<string, Record<string, unknown>>()
    let dropFirstReply = true
    const writer: HarvestWriter = {
      createDatasetItem: async (body) => {
        store.set(body.id as string, body)
        // The first create resolves without an id, as a swallowed 429 does.
        if (dropFirstReply) {
          dropFirstReply = false
          return {}
        }
        return { id: body.id }
      },
      getDatasetItem: async (id) => store.get(id) ?? null,
    }
    const sleeps: number[] = []
    const result = await applyPool(pool, writer, { sleep: async (ms) => { sleeps.push(ms) } })

    expect(result).toMatchObject({ written: 3, skippedReviewed: 1 })
    expect(store.has('name-golden-done')).toBe(false)

    const newSplit = pool.find((item) => item.id === 'names-submission-new')!.split
    expect(store.get('names-submission-new')).toEqual({
      datasetName: 'name-arbiter-confidence-golden',
      id: 'names-submission-new',
      input: { user: items[0]!.user, promptName: 'name-arbiter' },
      expectedOutput: null,
      status: 'ACTIVE',
      metadata: {
        split: newSplit,
        hardTags: ['trailing-segment'],
        harvestedBy: 'DEV-1896',
        sourceRowId: 'row-9',
        humanApproval: { status: 'pending' },
      },
    })

    const open = store.get('name-golden-open')!
    expect(open.input).toEqual(existing[0]!.input)
    expect(open.expectedOutput).toEqual(existing[0]!.expectedOutput)
    expect(open.metadata).toEqual({ note: 'keep me', split: expect.any(String), hardTags: ['trailing-segment'] })

    // A reviewed item with no split yet gets the split merged; its labels stay.
    const unsplit = store.get('name-golden-unsplit')!
    expect(unsplit.metadata).toEqual({ humanApproval: { status: 'approved', reviewedVia }, split: expect.any(String), hardTags: ['trailing-segment'] })
    expect(unsplit.expectedOutput).toEqual(existing[2]!.expectedOutput)

    expect(sleeps.length).toBeGreaterThan(0)

    const lying: HarvestWriter = { createDatasetItem: async (body) => ({ id: body.id }), getDatasetItem: async () => null }
    await expect(applyPool(pool, lying, { sleep: async () => {}, log: () => {} })).rejects.toThrow(/names-submission-new/)
  })

  it('apply moves a reviewed holdout item that becomes pinned to train, leaving its labels untouched', async () => {
    const reviewedVia = { queueId: null, scoreId: 'score-2' }
    const metadata = { split: 'holdout', hardTags: [], humanApproval: { status: 'approved', reviewedVia } }
    // A later prompt version quotes this item's stored name.
    const quoted = existingItem('name-golden-quoted', 'quoted-brand', '藺草工坊 Quoted', [cleaned('Quoted')], metadata)
    const pool = assignSplits(buildPool({ existing: [quoted], harvested: [], leakStrings: leaks }).pool, 'seed-a')
    expect(pool[0]).toMatchObject({ pinned: true, split: 'train' })

    const store = new Map<string, Record<string, unknown>>()
    const writer: HarvestWriter = {
      createDatasetItem: async (body) => {
        store.set(body.id as string, body)
        return { id: body.id }
      },
      getDatasetItem: async (id) => store.get(id) ?? null,
    }
    const logs: string[] = []
    const result = await applyPool(pool, writer, { sleep: async () => {}, log: (msg) => logs.push(msg) })

    expect(result).toMatchObject({ written: 1, repinned: 1, skippedReviewed: 0 })
    expect(store.get('name-golden-quoted')).toEqual({
      datasetName: 'name-arbiter-confidence-golden',
      id: 'name-golden-quoted',
      input: quoted.input,
      expectedOutput: quoted.expectedOutput,
      status: 'ACTIVE',
      metadata: { ...metadata, split: 'train' },
    })
    expect(logs.join('\n')).toMatch(/name-golden-quoted.*holdout.*train/)
  })

  it('apply never rewrites a new id that Langfuse already holds, in any status', async () => {
    const { items } = harvestRows([
      row('row-3', '2026-09-01T00:00:00Z', [
        line('submission-rejected', 'Rejected Brand', [cleaned('Rejected')], 1),
        line('submission-fresh', 'Fresh Brand', [cleaned('Fresh')], 2),
      ]),
    ])
    const pool = assignSplits(buildPool({ existing: [], harvested: items, leakStrings: leaks }).pool, 'seed-a')

    // The dataset listing omitted this item because it is ARCHIVED (rejected by the panel).
    const archived = {
      id: 'names-submission-rejected',
      status: 'ARCHIVED',
      input: { user: 'stored', promptName: 'name-arbiter' },
      expectedOutput: null,
      metadata: { split: 'val', humanApproval: { status: 'rejected' } },
    }
    const store = new Map<string, Record<string, unknown>>([[archived.id, archived]])
    const created: string[] = []
    const writer: HarvestWriter = {
      createDatasetItem: async (body) => {
        created.push(body.id as string)
        store.set(body.id as string, body)
        return { id: body.id }
      },
      // The public API rejects an absent id with a 404.
      getDatasetItem: async (id) => (store.has(id) ? store.get(id) : Promise.reject({ status: 404 })),
    }
    const logs: string[] = []
    const result = await applyPool(pool, writer, { sleep: async () => {}, log: (msg) => logs.push(msg) })

    expect(created).toEqual(['names-submission-fresh'])
    expect(store.get(archived.id)).toBe(archived)
    expect(result).toMatchObject({ written: 1, skippedExists: 1 })
    expect(logs.join('\n')).toContain('names-submission-rejected skipped (exists, ARCHIVED)')
  })
})

function poolItem(id: string, hardTags: PoolItem['hardTags']): PoolItem {
  return { id, slug: id, storedName: id, user: id, values: [id], hardTags, pinned: false }
}
