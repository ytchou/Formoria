import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseSubmissionStockists } from '@/lib/types/enriched-data'
import {
  buildEnrichedStockistRows,
  type ExistingStockistRow,
  materializeSubmissionStockists,
  resolveEnrichedStockistRows,
  STOCKIST_DETAIL_READ_SELECT,
  type StockistsSupabase,
  upsertEnrichedStockists,
} from '../stockists'

const serviceSource = readFileSync(
  resolve(process.cwd(), 'src/lib/services/stockists.ts'),
  'utf8',
)

/** The body of one top-level function, up to the next declaration. */
function functionBody(source: string, name: string): string {
  const declaration = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm
  const starts = [...source.matchAll(declaration)].map((match) => ({
    name: match[1],
    index: match.index ?? 0,
  }))
  const position = starts.findIndex((entry) => entry.name === name)
  if (position === -1) throw new Error(`No function ${name} in source`)
  return source.slice(
    starts[position].index,
    starts[position + 1]?.index ?? source.length,
  )
}

describe('brand channel provenance', () => {
  it('forwards imported provenance into the RPC row payload', () => {
    const { rows, invalidCount } = buildEnrichedStockistRows([
      {
        name: '好丘 信義店',
        normalizedName: '好丘信義',
        regionLabel: '臺北市',
        address: '臺北市信義區松勤街54號',
        url: 'https://www.goodcho.com.tw/stores/xinyi',
        source: 'import',
        sourceUrl: 'https://www.goodcho.com.tw/stores',
        fetchedAt: '2026-08-11T07:00:00.000Z',
        locationType: 'stockist',
        country: 'TW',
        providerMetadata: {
          sourceChain: 'official directory',
          confidence: 'high',
        },
      },
    ])

    expect(invalidCount).toBe(0)
    expect(rows).toEqual([
      expect.objectContaining({
        source: 'import',
        source_url: 'https://www.goodcho.com.tw/stores',
        fetched_at: '2026-08-11T07:00:00.000Z',
        location_type: 'stockist',
        country: 'TW',
        provider_metadata: {
          sourceChain: 'official directory',
          confidence: 'high',
        },
      }),
    ])
  })

  it('defaults legacy enriched candidates to the enriched source', () => {
    const { rows } = buildEnrichedStockistRows([
      {
        name: '誠品生活松菸店',
        normalizedName: '誠品生活松菸',
      },
    ])

    expect(rows.at(0)?.source).toBe('enriched')
  })

  it('selects every provenance field exposed on a displayed channel', () => {
    expect(STOCKIST_DETAIL_READ_SELECT).toContain('source_url')
    expect(STOCKIST_DETAIL_READ_SELECT).toContain('fetched_at')
    expect(STOCKIST_DETAIL_READ_SELECT).toContain('location_type')
    expect(STOCKIST_DETAIL_READ_SELECT).toContain('country')
  })

})

/**
 * A community submission is a stranger's claim about a shop until an admin has
 * looked at it, so it must be invisible on every public read. There are FOUR of
 * those reads and no compiler relates them: the per-brand read, the two
 * paginated directory reads, and the independent query in
 * `scripts/story-facts.ts`.
 *
 * Asserted against the SOURCE, deliberately. These functions build their own
 * service client and `check-test-boundaries.mjs` forbids mocking it, so the
 * behaviour itself is covered by `stockist-queue.integration.test.ts` against a
 * real database. What cannot be covered there — and what actually broke twice
 * on the sibling `excludeTestBrands` guard — is a NEW read path that simply
 * forgets the filter. That property is static, so it is checked statically,
 * exactly as `scripts/check-test-brand-filter.mjs` does for brands.
 */
describe('pending community stockists are hidden from public reads', () => {
  const storyFactsSource = readFileSync(
    resolve(process.cwd(), 'scripts/story-facts.ts'),
    'utf8',
  )

  it('hides pending community rows from the brand-detail read', () => {
    expect(functionBody(serviceSource, 'getStockistsForBrand')).toContain(
      'applyPublicStockistVisibility(',
    )
  })

  it('keeps pending community rows out of story facts', () => {
    // `scripts/story-facts.ts` runs `main()` at module scope, so it cannot be
    // imported by a test — importing it would run the script.
    expect(functionBody(storyFactsSource, 'fetchStockists')).toContain(
      'applyPublicStockistVisibility(',
    )
  })

  it('STOCKIST_DETAIL_READ_SELECT no longer embeds confirmations', () => {
    expect(STOCKIST_DETAIL_READ_SELECT).not.toContain('brand_channel_confirmations')
    expect(STOCKIST_DETAIL_READ_SELECT).not.toContain('confirmation')
    // The approver is what separates a brand's own confirmation from an admin's.
    expect(STOCKIST_DETAIL_READ_SELECT).toContain('owner_status_by')
  })

  /**
   * The submission cap is refused with 此品牌的實體通路已達上限 — a sentence
   * the reader checks against the list on the page. Counting rows that list
   * cannot show lets one account wedge a brand with 5 hidden submissions, and
   * the brand's own owner is locked out too. Same predicate as the read, from
   * the same helper: the rows a hand-written filter list forgets are exactly
   * the invisible ones. Which rows survive is asserted over a row set in
   * `stockist-display.test.ts`.
   */
  it('counts the cap over exactly the rows the public read returns', () => {
    const body = functionBody(serviceSource, 'countActiveStockists')

    expect(body).toContain('applyPublicStockistVisibility(')
    expect(body).not.toContain(".neq('owner_status'")
    expect(body).not.toContain(".is('removed_at'")
  })

  it('decides a community submission only while it is still in the queue', () => {
    // The write, the queue read, and the queue badge share one predicate. The
    // write is the one that matters: without `removed_at is null` an admin can
    // approve a tombstoned row the queue never showed them.
    expect(functionBody(serviceSource, 'reviewCommunityStockist')).toContain(
      'applyPendingCommunityStockistFilter(',
    )
    expect(functionBody(serviceSource, 'listPendingCommunityStockists')).toContain(
      'applyPendingCommunityStockistFilter(',
    )
    expect(
      readFileSync(
        resolve(process.cwd(), 'src/lib/services/admin-operations.ts'),
        'utf8',
      ),
    ).toContain('applyPendingCommunityStockistFilter(')
  })
})

/**
 * Approving a community submission publishes a stranger's claim about a shop
 * onto a live brand page — the same class of editorial decision as promoting a
 * curated product, which `admin-audit.ts` already names as the reason those are
 * logged. `brand_channels` keeps only `owner_status_by`, so without this row
 * there is no record of which way a decision went or that a rejection happened
 * at all.
 *
 * Asserted against the SOURCE: `reviewStockistAction` is a `'use server'`
 * action that authenticates and revalidates, so importing it into a unit test
 * would pull the whole Next.js request context. What can drift is the call
 * simply not being there.
 */
describe('community stockist reviews are audited', () => {
  const reviewAction = functionBody(
    readFileSync(resolve(process.cwd(), 'src/app/admin/actions.ts'), 'utf8'),
    'reviewStockistAction',
  )

  it('logs the decision with the action value for each direction', () => {
    expect(reviewAction).toContain('logAdminAction(')
    expect(reviewAction).toContain("'stockist_approved'")
    expect(reviewAction).toContain("'stockist_rejected'")
  })

  it('records the brand the claim was published onto', () => {
    // `target_brand_id` survives a slug rename; the slug alone does not.
    expect(reviewAction).toContain('targetBrandId: result.brandId')
  })
})

/**
 * `src/lib/audit/providers.ts` holds audited operation names as BARE STRING
 * LITERALS. No compiler relates them to the functions they name, so a rename
 * that misses one does not fail to build, fail to lint, or throw at runtime —
 * the operation simply stops being recorded, silently and forever.
 *
 * The DEV-1513 rename moved three of those names at once
 * (`setOwnerChannelStatus`, `submitChannel`, `upsertEnrichedChannels`), which
 * is exactly the shape of change that leaves a stale literal behind. This
 * asserts the registry against the SOURCE of the service: each audited
 * stockist operation must exist as an exported function with a
 * character-identical name.
 */
describe('audit registry names every audited stockist operation', () => {
  const serviceSource = readFileSync(
    resolve(process.cwd(), 'src/lib/services/stockists.ts'),
    'utf8',
  )
  const providersSource = readFileSync(
    resolve(process.cwd(), 'src/lib/audit/providers.ts'),
    'utf8',
  )

  /** Every `export function` / `export async function` name in the service. */
  const exportedFunctions = new Set(
    [...serviceSource.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map(
      (match) => match[1],
    ),
  )

  /** Every quoted string in the audit registry. */
  const registryStrings = new Set(
    [...providersSource.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)].map(
      (match) => match[1],
    ),
  )

  const auditedStockistOperations = [
    'submitStockist',
    'upsertEnrichedStockists',
    'materializeSubmissionStockists',
  ]

  it.each(auditedStockistOperations)(
    'registers %s under a name the service actually exports',
    (operation) => {
      expect(registryStrings.has(operation)).toBe(true)
      expect(exportedFunctions.has(operation)).toBe(true)
    },
  )

  it('leaves no channel-named operation behind in the registry', () => {
    // Matched by PATTERN, not against the three retired literals: the registry
    // covers every audited provider, so a channel-named survivor anywhere in it
    // is a dead hook whether or not it was one of the names this task moved.
    // The retired stockist names all ended in Channel / Channels / ChannelStatus
    // (submitChannel, upsertEnrichedChannels, setOwnerChannelStatus); the pattern
    // keys on that suffix so purchase-channel operations such as
    // reportChannelVerdicts (DEV-1702) are not mistaken for stockist survivors.
    expect(
      [...registryStrings].filter((name) => /Channels?(Status)?$/.test(name)),
    ).toEqual([])
  })
})

describe('submission stockists materialize at apply/approve', () => {
  it('feeds parseSubmissionStockists output straight into the row builder', () => {
    // The shape `enriched_data.stockists` is stored in: camelCase candidates.
    const parsed = parseSubmissionStockists([
      {
        name: '誠品生活松菸店',
        normalizedName: '誠品生活松菸',
        regionLabel: '臺北市',
        address: '臺北市信義區菸廠路88號',
        locationType: 'department_store_counter',
        country: 'TW',
        sourceUrl: 'https://example.com/stores',
      },
      { name: '   ', normalizedName: '' },
      'not-a-candidate',
    ])
    expect(parsed).not.toBeNull()

    const { rows, invalidCount } = buildEnrichedStockistRows(parsed ?? [])

    expect(invalidCount).toBe(0)
    expect(rows).toEqual([
      expect.objectContaining({
        name: '誠品生活松菸店',
        normalized_name: '誠品生活松菸',
        region_label: '臺北市',
        address: '臺北市信義區菸廠路88號',
        location_type: 'department_store_counter',
        country: 'TW',
        source: 'enriched',
        source_url: 'https://example.com/stores',
      }),
    ])
  })

})

/**
 * A hand-built stand-in for the three client calls the materializer makes: the
 * submission read, the brand's existing `brand_channels` read, and the upsert
 * RPC. Injected through the `client` seam, so no Supabase or service module is
 * mocked.
 */
function fakeStockistsClient(options: {
  enrichedData?: Record<string, unknown> | null
  existing?: ExistingStockistRow[]
  rpcResult?: { data: unknown; error: { message: string } | null }
}) {
  const reads: { table: string; columns: string; id: unknown }[] = []
  const ranges: [number, number][] = []
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = []
  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          return {
            eq(_column: string, id: unknown) {
              if (table === 'brand_channels') {
                return {
                  order() {
                    return {
                      async range(from: number, to: number) {
                        reads.push({ table, columns, id })
                        ranges.push([from, to])
                        return {
                          data: (options.existing ?? []).slice(from, to + 1),
                          error: null,
                        }
                      },
                    }
                  },
                }
              }
              reads.push({ table, columns, id })
              return {
                single: async () =>
                  options.enrichedData === null
                    ? { data: null, error: { message: 'not found' } }
                    : {
                        data: { enriched_data: options.enrichedData ?? {} },
                        error: null,
                      },
              }
            },
          }
        },
      }
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args })
      return options.rpcResult ?? { data: null, error: null }
    },
  }
  return {
    client: client as unknown as StockistsSupabase,
    reads,
    ranges,
    rpcCalls,
  }
}

describe('materializeSubmissionStockists', () => {
  const stockists = [
    {
      name: '誠品生活松菸店',
      normalizedName: '誠品生活松菸',
      regionLabel: '臺北市',
    },
    { name: '小器 赤峰', normalizedName: '小器赤峰' },
  ]

  it('reads the submission and upserts rows built from its stockists', async () => {
    const fake = fakeStockistsClient({ enrichedData: { stockists } })

    const result = await materializeSubmissionStockists('sub-1', 'brand-1', {
      client: fake.client,
    })

    expect(fake.reads).toEqual([
      { table: 'brand_submissions', columns: 'enriched_data', id: 'sub-1' },
      {
        table: 'brand_channels',
        columns:
          'name, normalized_name, address, source, owner_status, removed_at',
        id: 'brand-1',
      },
    ])
    expect(fake.rpcCalls).toEqual([
      {
        name: 'upsert_enriched_brand_channels',
        args: {
          p_brand_id: 'brand-1',
          p_candidates: buildEnrichedStockistRows(stockists).rows,
        },
      },
    ])
    expect(result).toEqual({ count: 2 })
  })

  it('reuses_the_existing_rows_normalized_name_for_a_near_duplicate', async () => {
    // Staging `his-cross-concept` (DEV-1942): three import rows, then three
    // enriched candidates naming the same stores differently.
    const existing = [
      {
        name: 'Rocco Coffee 若渴咖啡',
        normalized_name: 'roccocoffee若渴咖啡',
        address: '10491台北市中山區南京東路三段119號',
      },
      {
        name: 'Standfirm｜HIS 特約專櫃',
        normalized_name: 'standfirm｜his特約專櫃',
        address: '台北市南港區南港路3段16巷8號2樓',
      },
      {
        name: '高雄以諾書房',
        normalized_name: '高雄以諾書房',
        address: '高雄市新興區中正三路70號',
      },
    ]
    const enriched = [
      {
        name: 'Rocco Coffee 若渴咖啡｜HIS 展售',
        normalizedName: 'roccocoffee若渴咖啡｜his展售',
        address: '台北市中山區南京東路三段119號',
      },
      {
        name: '台北 Standfirm 特約專櫃',
        normalizedName: '台北standfirm特約專櫃',
        address: '台北市南港區南港路三段16巷8號2樓',
      },
      {
        name: '高雄以諾書房｜HIS 展售',
        normalizedName: '高雄以諾書房｜his展售',
        address: '高雄市新興區中正三路70號',
      },
    ]
    const fake = fakeStockistsClient({
      enrichedData: { stockists: enriched },
      existing,
    })

    await materializeSubmissionStockists('sub-1', 'brand-1', {
      client: fake.client,
    })

    const payload = fake.rpcCalls[0]?.args.p_candidates as {
      normalized_name: string
    }[]
    expect(payload.map((row) => row.normalized_name)).toEqual(
      existing.map((row) => row.normalized_name),
    )
  })

  it('drops_a_near_duplicate_repeated_within_the_batch', async () => {
    const fake = fakeStockistsClient({
      enrichedData: {
        stockists: [
          {
            name: '高雄以諾書房',
            normalizedName: '高雄以諾書房',
            address: '高雄市新興區中正三路70號',
          },
          {
            name: '高雄以諾書房｜HIS 展售',
            normalizedName: '高雄以諾書房｜his展售',
            address: '高雄市新興區中正三路70號',
          },
        ],
      },
    })

    await materializeSubmissionStockists('sub-1', 'brand-1', {
      client: fake.client,
    })

    const payload = fake.rpcCalls[0]?.args.p_candidates as { name: string }[]
    expect(payload.map((row) => row.name)).toEqual(['高雄以諾書房'])
  })

  it('keeps_same_name_candidates_the_import_split_by_region', () => {
    // scripts/enrichment/data/stockist-import/plan.ts region-suffixes the
    // normalized name of same-name stores in different cities. Without an
    // address on both sides they never near-match: not each other, and not an
    // older unsuffixed row.
    const { rows } = buildEnrichedStockistRows([
      { name: '好丘', normalizedName: '好丘:台北市', regionLabel: '台北市' },
      { name: '好丘', normalizedName: '好丘:台中市', regionLabel: '台中市' },
    ])
    const existing = [
      { name: '好丘', normalized_name: '好丘', address: null },
    ]

    for (const pool of [[], existing]) {
      const resolution = resolveEnrichedStockistRows(rows, pool)
      expect(resolution.rows.map((row) => row.normalized_name)).toEqual([
        '好丘:台北市',
        '好丘:台中市',
      ])
      expect(resolution.newRowCount).toBe(2)
    }
  })

  it('keeps_taipei_and_taichung_branches_apart_without_coalescing_an_address', () => {
    const taichungAddress = '台中市西區民生路368巷4弄6號'
    const { rows } = buildEnrichedStockistRows([
      { name: '台北 好丘', normalizedName: '台北好丘' },
      { name: '台中 好丘', normalizedName: '台中好丘', address: taichungAddress },
    ])

    const inBatch = resolveEnrichedStockistRows(rows, [])
    expect(inBatch.rows.map((row) => [row.normalized_name, row.address])).toEqual([
      ['台北好丘', null],
      ['台中好丘', taichungAddress],
    ])
    expect(inBatch.nearDuplicateCount).toBe(0)

    const againstExisting = resolveEnrichedStockistRows(rows.slice(1), [
      { name: '台北 好丘', normalized_name: '台北好丘', address: null },
    ])
    expect(againstExisting.rows.map((row) => row.normalized_name)).toEqual([
      '台中好丘',
    ])
    expect(againstExisting.newRowCount).toBe(1)
  })

  it('near_matches_no_pending_community_row_but_still_exact_matches_one', () => {
    const address = '台北市南港區南港路三段16巷8號2樓'
    const pendingCommunity = {
      name: 'Standfirm｜HIS 特約專櫃',
      normalized_name: 'standfirm｜his特約專櫃',
      address,
      source: 'community',
      owner_status: 'none',
      removed_at: null,
    }

    const near = resolveEnrichedStockistRows(
      buildEnrichedStockistRows([
        { name: '台北 Standfirm 特約專櫃', normalizedName: '台北standfirm特約專櫃', address },
      ]).rows,
      [pendingCommunity],
    )
    expect(near.rows.map((row) => row.normalized_name)).toEqual([
      '台北standfirm特約專櫃',
    ])
    expect(near.newRowCount).toBe(1)

    const exact = resolveEnrichedStockistRows(
      buildEnrichedStockistRows([
        { name: 'Standfirm｜HIS 特約專櫃', normalizedName: 'standfirm｜his特約專櫃' },
      ]).rows,
      [pendingCommunity],
    )
    expect(exact.rows.map((row) => row.normalized_name)).toEqual([
      'standfirm｜his特約專櫃',
    ])
    expect(exact.newRowCount).toBe(0)
  })

  it('resolves_matched_candidates_before_deduping_unmatched_ones', () => {
    // The existing row has no address, so only the exact-key candidate
    // matches it; the other shares that candidate's address. Either order,
    // the existing row gets the exact-key candidate and nothing is inserted.
    const address = '高雄市新興區中正三路70號'
    const exactKey = {
      name: '高雄以諾書房',
      normalizedName: '高雄以諾書房',
      address,
    }
    const weaker = {
      name: '高雄以諾書房｜HIS 展售',
      normalizedName: '高雄以諾書房｜his展售',
      address,
    }
    const existing = [
      { name: '高雄以諾書房', normalized_name: '高雄以諾書房', address: null },
    ]

    for (const candidates of [
      [weaker, exactKey],
      [exactKey, weaker],
    ]) {
      const resolution = resolveEnrichedStockistRows(
        buildEnrichedStockistRows(candidates).rows,
        existing,
      )
      expect(resolution.rows.map((row) => row.name)).toEqual(['高雄以諾書房'])
      expect(resolution.nearDuplicateCount).toBe(1)
      expect(resolution.newRowCount).toBe(0)
    }
  })

  it('merges_a_dropped_near_duplicates_fields_into_the_kept_row', () => {
    const address = '高雄市新興區中正三路70號'
    const { rows } = buildEnrichedStockistRows([
      {
        name: '高雄以諾書房',
        normalizedName: '高雄以諾書房',
        address,
        url: 'https://enoch.example/kept',
      },
      {
        name: '高雄以諾書房｜HIS 展售',
        normalizedName: '高雄以諾書房｜his展售',
        address,
        url: 'https://enoch.example/dropped',
        regionLabel: '高雄市',
        district: '新興區',
        country: 'TW',
        sourceUrl: 'https://his.example/stores',
      },
    ])

    const resolution = resolveEnrichedStockistRows(rows, [])
    expect(resolution.rows).toEqual([
      expect.objectContaining({
        name: '高雄以諾書房',
        url: 'https://enoch.example/kept',
        region_label: '高雄市',
        district: '新興區',
        country: 'TW',
        source_url: 'https://his.example/stores',
      }),
    ])
    // The input rows are not mutated.
    expect(rows[0]?.region_label).toBeNull()
  })

  it('reports_invalid_near_duplicate_and_blocked_counts', async () => {
    const address = '高雄市新興區中正三路70號'
    const fake = fakeStockistsClient({
      existing: [
        {
          name: '小器 赤峰',
          normalized_name: '小器赤峰',
          address: null,
          source: 'enriched',
          owner_status: 'rejected',
          removed_at: null,
        },
      ],
      rpcResult: { data: 1, error: null },
    })

    await expect(
      upsertEnrichedStockists(
        'brand-1',
        [
          { name: '高雄以諾書房', normalizedName: '高雄以諾書房', address },
          {
            name: '高雄以諾書房｜HIS 展售',
            normalizedName: '高雄以諾書房｜his展售',
            address,
          },
          { name: '小器 赤峰', normalizedName: '小器赤峰' },
          { name: ' ', normalizedName: ' ' },
        ],
        { client: fake.client },
      ),
    ).resolves.toEqual({
      ok: true,
      count: 1,
      resolvedCount: 2,
      invalidCount: 1,
      nearDuplicateCount: 1,
      blockedCount: 1,
    })
  })

  it('pages_the_existing_row_read', async () => {
    const existing = Array.from({ length: 1001 }, (_, index) => ({
      name: `store ${index}`,
      normalized_name: `store${index}`,
      address: null,
    }))
    const fake = fakeStockistsClient({ existing })

    await upsertEnrichedStockists(
      'brand-1',
      [{ name: 'store 1000', normalizedName: 'store1000' }],
      { client: fake.client },
    )

    expect(fake.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ])
  })

  it('returns the count the RPC reports', async () => {
    const fake = fakeStockistsClient({
      enrichedData: { stockists },
      rpcResult: { data: 1, error: null },
    })

    await expect(
      materializeSubmissionStockists('sub-1', 'brand-1', { client: fake.client }),
    ).resolves.toEqual({ count: 1 })
  })

  it('returns null and writes nothing when the submission has no stockists', async () => {
    const fake = fakeStockistsClient({ enrichedData: { faq: {} } })

    await expect(
      materializeSubmissionStockists('sub-1', 'brand-1', { client: fake.client }),
    ).resolves.toBeNull()
    expect(fake.rpcCalls).toEqual([])
  })

  it('returns null when the submission is missing', async () => {
    const fake = fakeStockistsClient({ enrichedData: null })

    await expect(
      materializeSubmissionStockists('sub-1', 'brand-1', { client: fake.client }),
    ).resolves.toBeNull()
    expect(fake.rpcCalls).toEqual([])
  })

  it('throws when the RPC fails', async () => {
    const fake = fakeStockistsClient({
      enrichedData: { stockists },
      rpcResult: { data: null, error: { message: 'boom' } },
    })

    await expect(
      materializeSubmissionStockists('sub-1', 'brand-1', { client: fake.client }),
    ).rejects.toThrow('upsert failed (database_error)')
  })
})
