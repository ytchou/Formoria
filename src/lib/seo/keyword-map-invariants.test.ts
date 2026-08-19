import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { describe, expect, it } from 'vitest'
import {
  L1_CATEGORIES,
  L2_SUBCATEGORIES,
  isCompositeSubcategory,
  subcategoryBySlug,
} from '@/lib/taxonomy/ontology'
import {
  DEFAULT_KEYWORD_MAP_PATH,
  derivePriority,
  loadKeywordMap,
  type KeywordCluster,
  type KeywordMap,
} from './keyword-map'

/**
 * Invariants over the REAL committed map (content/seo/keyword-map.yaml), not
 * fixtures. keyword-map.test.ts covers the schema in the abstract; this file
 * covers the one artifact that ships. A failure here means the map itself is
 * wrong — two pages fighting for a keyword, a slug that no longer exists in the
 * ontology, a hand-edited priority — not that the parser regressed.
 */

const map: KeywordMap = loadKeywordMap(DEFAULT_KEYWORD_MAP_PATH)
const { clusters, unmapped_backlog: backlog } = map

const L1_SLUGS = new Set<string>(L1_CATEGORIES.map(category => category.slug))
const TAXONOMY_PAGE_TYPES = new Set(['l1-category', 'l2-category'])
const RECLASSIFIED_SYNONYM_SLUGS = new Set([
  'essential-oils-and-hydrosols',
  'bracelets-and-bangles',
])
const REPARENTED_OR_RETIRED_SLUGS = new Set([
  'supplements',
  'hand-tools',
  'care-and-mobility-aids',
  'gift-boxes',
  'custom-gifts',
  'workshops-and-diy-kits',
  'baby-gift-sets',
  // Added by DEV-1510: `kids-pets` was split into the live L1s `kids` and
  // `pets`, so no page owns the merged slug any more — /categories/kids-pets
  // 301s to /brands. A live row pointing back at it would resurrect the exact
  // chain the split had to remove.
  'kids-pets',
])
const REQUIRED_PAGE_ROLES = [
  'homepage',
  'directory',
  'topic-hub',
  'story',
  'glossary',
  'stats',
  'brand-detail',
] as const

/** The unvalidated shape of a cluster row, for the raw-parse priority check. */
type RawClusterRow = {
  id: string
  primary_keyword: string
  priority?: string
  brand_count: number
  intent_fit: number
  differentiation: number
}

function describeCluster(cluster: KeywordCluster): string {
  return `${cluster.id} (${cluster.primary_keyword})`
}

describe('keyword map invariants', () => {
  it('every cluster parses against the schema', () => {
    // loadKeywordMap (module scope, line ~23) throws on any schema violation, so
    // reaching this line is already the assertion. Re-calling it here would cost
    // a second full read + parse + 87-row validation and could never fail.
    expect(clusters.length).toBeGreaterThan(0)
    expect(backlog.length).toBeGreaterThan(0)
  })

  it('each target_url has exactly one owning cluster', () => {
    const duplicateIds = clusters
      .map(cluster => cluster.id)
      .filter((id, index, all) => all.indexOf(id) !== index)
    expect(duplicateIds).toEqual([])

    // Keyed on target_url ALONE. Including page_type in the key was the bug:
    // an l1-category row and a topic-hub row both claiming /topics/craft is a
    // real cannibalization, and a page_type-scoped key never saw it.
    const ownerByUrl = new Map<string, KeywordCluster>()
    const conflicts: string[] = []

    for (const cluster of clusters) {
      if (!cluster.target_url) continue
      const existingOwner = ownerByUrl.get(cluster.target_url)
      if (existingOwner) {
        conflicts.push(
          `${cluster.target_url} is owned by both ${describeCluster(existingOwner)} [${existingOwner.page_type}] and ${describeCluster(cluster)} [${cluster.page_type}]`,
        )
        continue
      }
      ownerByUrl.set(cluster.target_url, cluster)
    }

    expect(conflicts).toEqual([])

    // The rule bites hardest on the rows that get built first.
    const prioritised = clusters.filter(
      cluster => cluster.priority === 'P0' || cluster.priority === 'P1',
    )
    expect(prioritised.length).toBeGreaterThan(0)
    for (const cluster of prioritised) {
      if (!cluster.target_url) continue
      expect(ownerByUrl.get(cluster.target_url)?.id).toBe(cluster.id)
    }
  })

  it('only non-live clusters may omit a target_url', () => {
    // The old invariant skipped URL-less rows silently, which excused all 11 of
    // them. Assert the exemption instead of assuming it: with the schema's
    // required-when-live rule in place, a URL-less row must be proposed/pending.
    const urlless = clusters.filter(cluster => !cluster.target_url)
    expect(urlless.length).toBeGreaterThan(0)

    const live = urlless
      .filter(cluster => cluster.target_status === 'live')
      .map(cluster => describeCluster(cluster))
    expect(live).toEqual([])
  })

  it('every live row has a target_url', () => {
    const missing = clusters
      .filter(cluster => cluster.target_status === 'live' && !cluster.target_url)
      .map(cluster => describeCluster(cluster))

    expect(missing).toEqual([])
  })

  it('every live L1/L2 target_url resolves to a real route', () => {
    const invalid: string[] = []

    for (const cluster of clusters) {
      if (cluster.target_status !== 'live' || !TAXONOMY_PAGE_TYPES.has(cluster.page_type)) {
        continue
      }

      const slug = cluster.ontology_slug
      if (!slug || !cluster.target_url) {
        invalid.push(`${describeCluster(cluster)} is missing route data`)
        continue
      }

      if (cluster.page_type === 'l1-category') {
        if (!L1_SLUGS.has(slug) || cluster.target_url !== `/categories/${slug}`) {
          invalid.push(`${describeCluster(cluster)} -> ${cluster.target_url}`)
        }
        continue
      }

      const subcategory = subcategoryBySlug(slug)
      const expectedUrl = subcategory ? `/categories/${subcategory.category}/${slug}` : null
      if (!subcategory || cluster.target_url !== expectedUrl) {
        invalid.push(`${describeCluster(cluster)} -> ${cluster.target_url}`)
      }
    }

    expect(invalid).toEqual([])
  })

  it('no reject-taxonomy row is marked live', () => {
    const rejected = clusters.filter(cluster => cluster.eligibility === 'reject-taxonomy')
    expect(rejected).toHaveLength(1)
    expect(rejected.every(cluster => cluster.target_status === 'proposed' && !cluster.target_url)).toBe(true)
  })

  it('DEV-1361 replacements are exact deferred noindex owners', () => {
    const replacements = [
      'home-fragrance',
      'candles',
      'keychains',
      'charms',
      'storage-pouches',
      'cosmetic-bags',
      'tea-bags',
      'tea-drinks',
      'toys',
      'learning-aids',
      'floral-arrangements',
      'plants',
      'towels',
      'home-textiles',
      'phone-bags',
      'phone-straps',
    ]
    const rows = replacements.map(slug => clusters.find(cluster => cluster.ontology_slug === slug))

    expect(rows.every(Boolean)).toBe(true)
    for (const row of rows) {
      expect(row).toMatchObject({
        target_status: 'proposed',
        brand_count: 0,
        data_quality: 'thin',
        eligibility: 'defer-data',
        composite: 'none',
        indexability: 'noindex',
      })
      expect(row?.target_url).toBeUndefined()
    }

    for (const retired of [
      'home-fragrance-and-candles',
      'keychains-and-charms',
      'pouches',
      'tea-bags-and-drinks',
      'floral-and-plants',
      'toys-and-learning',
      'phone-bags-and-straps',
      'towels-and-textiles',
    ]) {
      expect(clusters.some(cluster => cluster.ontology_slug === retired)).toBe(false)
    }

    const phoneStraps = clusters.find(cluster => cluster.ontology_slug === 'phone-straps')
    const charms = clusters.find(cluster => cluster.ontology_slug === 'charms')
    expect(phoneStraps?.secondary_keywords).toContain('台灣手機吊飾品牌')
    expect(charms?.primary_keyword).toBe('台灣吊飾品牌')
    expect(
      clusters.filter(cluster =>
        [cluster.primary_keyword, ...cluster.secondary_keywords].some(keyword =>
          keyword === '台灣手機吊飾品牌',
        ),
      ),
    ).toHaveLength(1)
  })

  it('no live target_url points at a reparented or retired slug', () => {
    const live = clusters
      .filter(
        cluster =>
          cluster.target_status === 'live' &&
          cluster.ontology_slug &&
          REPARENTED_OR_RETIRED_SLUGS.has(cluster.ontology_slug),
      )
      .map(cluster => describeCluster(cluster))

    expect(live).toEqual([])
  })

  it('the zh-TW L2 launch set stays between five and ten rows', () => {
    const launch = clusters.filter(
      cluster =>
        cluster.locale === 'zh-TW' &&
        cluster.page_type === 'l2-category' &&
        cluster.eligibility === 'launch',
    )

    expect(launch.length).toBeGreaterThanOrEqual(5)
    expect(launch.length).toBeLessThanOrEqual(10)
    // Still 10 after DEV-1510. The kids/pets split moves L1 rows only, and the
    // nine L2 nodes it added (umbrellas, gloves, cufflinks-and-tie-clips,
    // feminine-care, beauty-tools, pest-control, figurines-and-plush,
    // bookmarks, craft-kits-and-supplies) went to unmapped_backlog rather than
    // becoming launch clusters: none has a scoped brand_count, and a launch row
    // also requires bespoke zh-TW copy, which the case below enforces.
    expect(launch).toHaveLength(10)
  })

  it('every deferred L2 row that clears the 15-brand bar is defer-no-demand', () => {
    const deferredQualifying = clusters.filter(
      cluster =>
        cluster.locale === 'zh-TW' &&
        cluster.page_type === 'l2-category' &&
        cluster.brand_count >= 15 &&
        cluster.composite !== 'multi-intent' &&
        cluster.eligibility !== 'launch' &&
        cluster.eligibility !== 'reject-taxonomy',
    )

    // Still 25 after DEV-1510: every L2 node the split added carries
    // brand_count 0, so none clears the 15-brand bar, and the split itself
    // touched no L2 row's count.
    expect(deferredQualifying).toHaveLength(25)
    expect(
      deferredQualifying.every(
        cluster => cluster.eligibility === 'defer-no-demand' && cluster.target_status === 'proposed',
      ),
    ).toBe(true)
  })

  it('every launched L2 has bespoke zh-TW copy', () => {
    const messages = JSON.parse(
      readFileSync(resolve(process.cwd(), 'messages/zh-TW.json'), 'utf8'),
    ) as { categories?: { l2?: Record<string, unknown> } }
    const missing = clusters
      .filter(
        cluster =>
          cluster.locale === 'zh-TW' &&
          cluster.page_type === 'l2-category' &&
          cluster.eligibility === 'launch',
      )
      .filter(cluster => !cluster.ontology_slug || !messages.categories?.l2?.[cluster.ontology_slug])
      .map(cluster => describeCluster(cluster))

    expect(missing).toEqual([])
  })

  it('primary keywords are unique across the map', () => {
    const seen = new Map<string, string>()
    const duplicates: string[] = []

    for (const cluster of clusters) {
      const existingOwner = seen.get(cluster.primary_keyword)
      if (existingOwner) {
        duplicates.push(`"${cluster.primary_keyword}" claimed by ${existingOwner} and ${cluster.id}`)
        continue
      }
      seen.set(cluster.primary_keyword, cluster.id)
    }

    expect(duplicates).toEqual([])
  })

  it('no primary keyword appears as another cluster’s secondary keyword', () => {
    const primaryOwner = new Map(clusters.map(cluster => [cluster.primary_keyword, cluster.id]))
    const collisions: string[] = []

    for (const cluster of clusters) {
      for (const secondary of cluster.secondary_keywords) {
        const owner = primaryOwner.get(secondary)
        if (owner && owner !== cluster.id) {
          collisions.push(`${cluster.id} lists "${secondary}", the primary keyword of ${owner}`)
        }
      }
    }

    expect(collisions).toEqual([])
  })

  it('no secondary keyword is claimed by two clusters', () => {
    // Two pages both targeting the same secondary keyword cannibalize each other
    // exactly as a primary/secondary overlap does.
    const owner = new Map<string, string>()
    const collisions: string[] = []
    let secondaryCount = 0

    for (const cluster of clusters) {
      for (const secondary of cluster.secondary_keywords) {
        secondaryCount += 1
        const existing = owner.get(secondary)
        if (existing && existing !== cluster.id) {
          collisions.push(`"${secondary}" is listed by both ${existing} and ${cluster.id}`)
          continue
        }
        owner.set(secondary, cluster.id)
      }
    }

    expect(secondaryCount).toBeGreaterThan(0)
    expect(collisions).toEqual([])
  })

  it('every l1/l2 ontology_slug resolves against ontology.ts', () => {
    const unresolved: string[] = []

    for (const cluster of clusters) {
      if (!TAXONOMY_PAGE_TYPES.has(cluster.page_type)) continue
      const slug = cluster.ontology_slug
      expect(slug, `${describeCluster(cluster)} is missing ontology_slug`).toBeTruthy()
      if (!slug) continue

      // Kebab-case ASCII only: a zh-TW label must never leak into a URL key.
      expect(slug, `${describeCluster(cluster)} has a non-kebab ontology_slug`).toMatch(
        /^[a-z0-9]+(-[a-z0-9]+)*$/,
      )

      const resolves =
        cluster.page_type === 'l1-category' ? L1_SLUGS.has(slug) : subcategoryBySlug(slug) !== null
      if (!resolves) unresolved.push(`${describeCluster(cluster)} -> ${slug}`)
    }

    expect(unresolved).toEqual([])
  })

  it('every ontology L2 slug appears in the keyword map exactly once', () => {
    const rowsBySlug = new Map<string, string[]>()

    for (const cluster of clusters) {
      if (!cluster.ontology_slug) continue
      const rows = rowsBySlug.get(cluster.ontology_slug) ?? []
      rows.push(`cluster:${cluster.id}`)
      rowsBySlug.set(cluster.ontology_slug, rows)
    }
    for (const row of backlog) {
      const rows = rowsBySlug.get(row.slug) ?? []
      rows.push(`backlog:${row.slug}`)
      rowsBySlug.set(row.slug, rows)
    }

    const missing: string[] = []
    const duplicate: string[] = []
    for (const subcategory of L2_SUBCATEGORIES) {
      const rows = rowsBySlug.get(subcategory.slug) ?? []
      if (rows.length === 0) missing.push(subcategory.slug)
      if (rows.length > 1) duplicate.push(`${subcategory.slug}: ${rows.join(', ')}`)
    }

    expect(missing, `missing ontology slugs: ${missing.join(', ')}`).toEqual([])
    expect(duplicate, `duplicate ontology slugs: ${duplicate.join('; ')}`).toEqual([])
  })

  it('priority matches its derivation', () => {
    // Read the YAML RAW rather than through loadKeywordMap. The schema's
    // superRefine already rejects a mismatched priority at module scope, so
    // against the validated `clusters` this loop could never fail — a
    // hand-edited priority surfaced as an opaque import-time Zod error instead
    // of the per-cluster diff below. Parsing raw is what makes this case able to
    // fail on its own terms.
    const rawDocument = parseYaml(
      readFileSync(resolve(process.cwd(), DEFAULT_KEYWORD_MAP_PATH), 'utf8'),
    ) as { clusters?: RawClusterRow[] }
    const rawClusters = rawDocument.clusters ?? []
    expect(rawClusters).toHaveLength(clusters.length)

    const missing: string[] = []
    const mismatches: string[] = []

    for (const row of rawClusters) {
      const label = `${row.id} (${row.primary_keyword})`
      if (!row.priority) {
        missing.push(label)
        continue
      }
      const derived = derivePriority(row)
      if (row.priority !== derived) {
        mismatches.push(`${label}: stored ${row.priority}, derived ${derived}`)
      }
    }

    expect(missing).toEqual([])
    expect(mismatches).toEqual([])
  })

  it('all 13 L1 categories are covered', () => {
    const covered = new Set(
      clusters
        .filter(cluster => cluster.page_type === 'l1-category')
        .map(cluster => cluster.ontology_slug),
    )

    // 12 -> 13: DEV-1510 split `kids-pets` into `kids` and `pets`, so one L1 row
    // became two. An L1 that ships without a keyword row is a page nothing owns
    // — that is how `pets` would have gone live with a redirect still shadowing
    // it — so the count is pinned exactly, never widened to a floor.
    expect(L1_CATEGORIES).toHaveLength(13)
    const missing = L1_CATEGORIES.map(category => category.slug).filter(
      slug => !covered.has(slug),
    )
    expect(missing).toEqual([])
    expect(covered.size).toBe(13)
  })

  // DEV-1510's Test Contract names this case. The three exact counts it pins
  // are each asserted in their own case above; this one states them together so
  // the taxonomy's shape is checkable in one place. Exact, never a floor — a
  // count that drifts silently is how `pets` would have shipped with a redirect
  // still shadowing it.
  it('keyword_map_invariants_hold', () => {
    const launch = clusters.filter(
      cluster =>
        cluster.locale === 'zh-TW' &&
        cluster.page_type === 'l2-category' &&
        cluster.eligibility === 'launch',
    )
    expect(launch).toHaveLength(10)

    const deferredQualifying = clusters.filter(
      cluster =>
        cluster.locale === 'zh-TW' &&
        cluster.page_type === 'l2-category' &&
        cluster.brand_count >= 15 &&
        cluster.composite !== 'multi-intent' &&
        cluster.eligibility !== 'launch' &&
        cluster.eligibility !== 'reject-taxonomy',
    )
    expect(deferredQualifying).toHaveLength(25)

    // The merged slug must stay retired: a live row pointing back at it would
    // rebuild the /categories/pets -> /categories/kids-pets -> /brands chain.
    expect(REPARENTED_OR_RETIRED_SLUGS.has('kids-pets')).toBe(true)
    expect(L1_CATEGORIES).toHaveLength(13)
  })

  it('every required page role has an owner', () => {
    const rolesPresent = new Set(clusters.map(cluster => cluster.page_type))
    const missing = REQUIRED_PAGE_ROLES.filter(role => !rolesPresent.has(role))
    expect(missing).toEqual([])
  })

  it('english clusters are not marked live', () => {
    const englishClusters = clusters.filter(cluster => cluster.locale === 'en')
    expect(englishClusters.length).toBeGreaterThan(0)

    const notPending = englishClusters
      .filter(cluster => cluster.target_status !== 'pending')
      .map(cluster => `${describeCluster(cluster)} is ${cluster.target_status}`)
    expect(notPending).toEqual([])
  })

  it('no multi-intent composite is eligible to launch', () => {
    const multiIntent = clusters.filter(cluster => cluster.composite === 'multi-intent')
    // DEV-1361 removes the final taxonomy-rejected cluster rows. Remaining
    // multi-intent research signals stay in the unmapped backlog until their
    // own ontology work lands.
    expect(multiIntent).toEqual([])

    const violations: string[] = []
    for (const cluster of multiIntent) {
      if (cluster.eligibility !== 'reject-taxonomy') {
        violations.push(`${describeCluster(cluster)} has eligibility ${cluster.eligibility}`)
      }
      if (cluster.target_url) {
        violations.push(`${describeCluster(cluster)} names target_url ${cluster.target_url}`)
      }
    }

    expect(violations).toEqual([])
  })

  it('reclassified rows are no longer reject-taxonomy', () => {
    const missing: string[] = []
    const violations: string[] = []

    for (const slug of RECLASSIFIED_SYNONYM_SLUGS) {
      const cluster = clusters.find(row => row.ontology_slug === slug)
      if (!cluster) {
        missing.push(slug)
        continue
      }
      if (cluster.composite !== 'synonym') violations.push(`${slug} is ${cluster.composite}`)
      if (cluster.eligibility === 'reject-taxonomy') {
        violations.push(`${slug} remains reject-taxonomy`)
      }
      if (!cluster.target_url) violations.push(`${slug} is missing target_url`)
      if (cluster.indexability !== 'index') violations.push(`${slug} is ${cluster.indexability}`)
      if (cluster.eligibility !== 'defer-no-demand') {
        violations.push(`${slug} has eligibility ${cluster.eligibility}`)
      }
      if (!cluster.content_requirement || cluster.content_requirement.startsWith('None')) {
        violations.push(`${slug} is missing indexable-page content requirement`)
      }
      if (!/same (shelf|jewelry shelf)|buyer intent/i.test(cluster.notes)) {
        violations.push(`${slug} is missing same-shelf/buyer-intent rationale`)
      }
    }

    expect(missing, `missing reclassified rows: ${missing.join(', ')}`).toEqual([])
    expect(violations).toEqual([])
  })

  it('no two live rows compete for the same primary keyword', () => {
    const owners = new Map<string, string>()
    const conflicts: string[] = []

    for (const cluster of clusters.filter(cluster => cluster.target_status === 'live')) {
      const existing = owners.get(cluster.primary_keyword)
      if (existing) conflicts.push(`${cluster.primary_keyword}: ${existing} and ${cluster.id}`)
      owners.set(cluster.primary_keyword, cluster.id)
    }

    expect(conflicts).toEqual([])
  })

  it('activewear owns the performance-apparel intent', () => {
    const activewear = clusters.find(cluster => cluster.ontology_slug === 'activewear')
    const performanceApparel = clusters.find(cluster => cluster.ontology_slug === 'performance-apparel')

    expect(activewear, 'activewear map row is missing').toBeDefined()
    expect(activewear?.target_status).toBe('proposed')
    expect(activewear?.target_url).toBe('/categories/fashion/activewear')
    expect(activewear?.eligibility).not.toBe('reject-taxonomy')
    expect(activewear?.indexability).toBe('index')

    expect(performanceApparel, 'performance-apparel map row is missing').toBeDefined()
    expect(performanceApparel?.target_status).toBe('proposed')
    expect(performanceApparel?.eligibility).toBe('reject-taxonomy')
    expect(performanceApparel?.indexability).toBe('noindex')
    expect(performanceApparel?.target_url).toBeUndefined()
  })

  it('every composite ontology subcategory is classified with a definite value', () => {
    // The separator predicate lives in ontology.ts, which owns U+30FB — two
    // hand-rolled `includes('・')` spellings across two files was the bug.
    const compositeSubcategories = L2_SUBCATEGORIES.filter(isCompositeSubcategory)
    expect(compositeSubcategories.length).toBeGreaterThan(0)

    // Record WHICH classification, and treat a second, different classification
    // for one slug as a failure rather than a last-write-wins overwrite: the
    // synonym/multi-intent distinction drives launch eligibility.
    const classified = new Map<string, { value: string; source: string }>()
    const conflicts: string[] = []

    function record(slug: string, value: string, source: string): void {
      const existing = classified.get(slug)
      if (existing && existing.value !== value) {
        conflicts.push(
          `${slug} is "${existing.value}" per ${existing.source} but "${value}" per ${source}`,
        )
        return
      }
      classified.set(slug, { value, source })
    }

    for (const cluster of clusters) {
      if (!cluster.ontology_slug || cluster.composite === 'none') continue
      record(cluster.ontology_slug, cluster.composite, cluster.id)
    }
    for (const row of backlog) {
      if (!row.composite || row.composite === 'none') continue
      record(row.slug, row.composite, `backlog:${row.slug}`)
    }

    expect(conflicts).toEqual([])

    // Assert the recorded VALUE, not mere presence — `.has()` let a slug
    // recorded as anything at all pass.
    const unclassified = compositeSubcategories
      .filter(subcategory => {
        const entry = classified.get(subcategory.slug)
        return !entry || entry.value === 'none'
      })
      .map(subcategory => `${subcategory.slug} (${subcategory.nameZh})`)

    expect(unclassified).toEqual([])

    for (const subcategory of compositeSubcategories) {
      const entry = classified.get(subcategory.slug)
      expect(
        entry?.value,
        `${subcategory.slug} must be synonym or multi-intent, not "${entry?.value}"`,
      ).toMatch(/^(synonym|multi-intent)$/)
    }
  })
})
