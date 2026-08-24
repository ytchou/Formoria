import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  buildEnrichedStockistRows,
  buildStockistPageRanges,
  STOCKIST_DETAIL_READ_SELECT,
  groupStockistsForCity,
  matchesCategory,
  stockistDistrictSlugs,
  summarizeStockistCities,
  type StockistLocation,
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

function location(id: string, district: string | null): StockistLocation {
  return {
    id,
    name: `María García Stockist ${id}`,
    address: `臺北市${district ?? ''}南京東路1號`,
    url: null,
    country: 'TW',
    city: 'taipei',
    district,
    brandSlug: `maria-garcia-${id}`,
    brandName: `María García ${id}`,
    categorySlug: 'home',
    subcategories: [],
  }
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

  it('orders district sections by location count and leaves unmatched locations last', () => {
    const locations = [
      location('alpha', '信義區'),
      location('bravo', '中山區'),
      location('charlie', '中山區'),
      location('delta', null),
    ]

    expect(
      groupStockistsForCity(locations, 'taipei').map((group) => group.slug),
    ).toEqual(['taipei-zhongshan', 'taipei-xinyi', 'unassigned'])
  })

  it('summarizes only cities that have real locations', () => {
    expect(summarizeStockistCities([location('echo', '中山區')])).toMatchObject(
      [{ city: 'taipei', count: 1 }],
    )
  })

  it('requests every stockist page when the directory exceeds the Data API row cap', () => {
    expect(buildStockistPageRanges(1_354)).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1353 },
    ])
  })

  it('offers location jumps only for district sections present in the directory', () => {
    expect(
      stockistDistrictSlugs([
        location('foxtrot', '中山區'),
        location('golf', '中山區'),
        location('hotel', null),
      ]),
    ).toEqual(['taipei-zhongshan'])
  })
})

describe('stockist category filter over slug-stored subcategories', () => {
  function stockist(subcategories: string[]): StockistLocation {
    return {
      ...location('india', '中山區'),
      categorySlug: 'bags-accessories',
      subcategories,
    }
  }

  // A multi-word slug is the load-bearing case: 'tote-bags' normalizes to
  // neither nameZh nor an alias, so a name-keyed lookup resolves it to null and
  // the whole city page renders empty. The 58 single-word slugs pass either way.
  it('matches a brand whose stored subcategory is a multi-word slug', () => {
    expect(matchesCategory(stockist(['tote-bags']), 'tote-bags')).toBe(true)
  })

  it('still matches a pre-migration zh-TW label for the same node', () => {
    expect(matchesCategory(stockist(['托特包']), 'tote-bags')).toBe(true)
  })

  it('does not match a different L2 of the same L1', () => {
    expect(matchesCategory(stockist(['tote-bags']), 'backpacks')).toBe(false)
  })

  it('matches on the brand L1 and passes everything through with no filter', () => {
    expect(matchesCategory(stockist([]), 'bags-accessories')).toBe(true)
    expect(matchesCategory(stockist([]), undefined)).toBe(true)
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

  it('hides pending community rows from the cross-brand directory', () => {
    // TWO queries, because the reader pages: the first page and every
    // subsequent one. A predicate on only the first is a half-fix that hides
    // nothing beyond row 1000.
    const body = functionBody(serviceSource, 'fetchStockistRows')

    expect(body.match(/applyPublicStockistVisibility\(/g)).toHaveLength(2)
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
    expect(
      [...registryStrings].filter((name) => /channel/i.test(name)),
    ).toEqual([])
  })
})
