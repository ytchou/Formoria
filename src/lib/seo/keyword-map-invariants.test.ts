import { describe, expect, it } from 'vitest'
import {
  PRODUCT_TYPE_CATEGORIES,
  PRODUCT_SUBCATEGORIES,
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

const L1_SLUGS = new Set<string>(PRODUCT_TYPE_CATEGORIES.map(category => category.slug))
const TAXONOMY_PAGE_TYPES = new Set(['l1-category', 'l2-category'])
const REQUIRED_PAGE_ROLES = [
  'homepage',
  'directory',
  'topic-hub',
  'story',
  'glossary',
  'stats',
  'brand-detail',
] as const

function describeCluster(cluster: KeywordCluster): string {
  return `${cluster.id} (${cluster.primary_keyword})`
}

describe('keyword map invariants', () => {
  it('every cluster parses against the schema', () => {
    // loadKeywordMap throws on any schema violation, so reaching this line is
    // already the assertion; the expectations guard against an empty file.
    expect(() => loadKeywordMap(DEFAULT_KEYWORD_MAP_PATH)).not.toThrow()
    expect(clusters.length).toBeGreaterThan(0)
    expect(backlog.length).toBeGreaterThan(0)
  })

  it('each P0 and P1 cluster has exactly one target_url owner', () => {
    const duplicateIds = clusters
      .map(cluster => cluster.id)
      .filter((id, index, all) => all.indexOf(id) !== index)
    expect(duplicateIds).toEqual([])

    const ownerByUrlAndType = new Map<string, string>()
    const conflicts: string[] = []

    for (const cluster of clusters) {
      if (!cluster.target_url) continue
      const key = `${cluster.page_type} ${cluster.target_url}`
      const existingOwner = ownerByUrlAndType.get(key)
      if (existingOwner) {
        conflicts.push(`${key} is owned by both ${existingOwner} and ${cluster.id}`)
        continue
      }
      ownerByUrlAndType.set(key, cluster.id)
    }

    expect(conflicts).toEqual([])

    // The rule bites hardest on the rows that get built first.
    const prioritised = clusters.filter(
      cluster => cluster.priority === 'P0' || cluster.priority === 'P1',
    )
    expect(prioritised.length).toBeGreaterThan(0)
    for (const cluster of prioritised) {
      if (!cluster.target_url) continue
      expect(ownerByUrlAndType.get(`${cluster.page_type} ${cluster.target_url}`)).toBe(cluster.id)
    }
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

  it('priority matches its derivation', () => {
    const mismatches: string[] = []

    for (const cluster of clusters) {
      expect(cluster.priority, `${describeCluster(cluster)} has no priority`).toBeTruthy()
      const derived = derivePriority(cluster)
      if (cluster.priority !== derived) {
        mismatches.push(`${describeCluster(cluster)}: stored ${cluster.priority}, derived ${derived}`)
      }
    }

    expect(mismatches).toEqual([])
  })

  it('all 12 L1 categories are covered', () => {
    const covered = new Set(
      clusters
        .filter(cluster => cluster.page_type === 'l1-category')
        .map(cluster => cluster.ontology_slug),
    )

    expect(PRODUCT_TYPE_CATEGORIES).toHaveLength(12)
    const missing = PRODUCT_TYPE_CATEGORIES.map(category => category.slug).filter(
      slug => !covered.has(slug),
    )
    expect(missing).toEqual([])
    expect(covered.size).toBe(12)
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
    expect(multiIntent.length).toBeGreaterThan(0)

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

  it('every composite ontology subcategory is classified', () => {
    const compositeSubcategories = PRODUCT_SUBCATEGORIES.filter(subcategory =>
      subcategory.nameZh.includes('・'),
    )
    expect(compositeSubcategories.length).toBeGreaterThan(0)

    const classified = new Map<string, string>()
    for (const cluster of clusters) {
      if (!cluster.ontology_slug || cluster.composite === 'none') continue
      classified.set(cluster.ontology_slug, cluster.composite)
    }
    for (const row of backlog) {
      if (!row.composite || row.composite === 'none') continue
      classified.set(row.slug, row.composite)
    }

    const unclassified = compositeSubcategories
      .filter(subcategory => !classified.has(subcategory.slug))
      .map(subcategory => `${subcategory.slug} (${subcategory.nameZh})`)

    expect(unclassified).toEqual([])
  })
})
