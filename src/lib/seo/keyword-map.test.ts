import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  derivePriority,
  keywordClusterSchema,
  loadKeywordMap,
  type KeywordCluster,
} from './keyword-map'

const tempDirs: string[] = []

function writeTempYaml(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'keyword-map-'))
  tempDirs.push(dir)
  const file = join(dir, 'keyword-map.yaml')
  writeFileSync(file, contents, 'utf8')
  return file
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

const backpackCluster = {
  id: 'l2-backpacks',
  primary_keyword: '台灣後背包品牌',
  secondary_keywords: ['後背包推薦', '台灣製後背包'],
  search_intent: 'commercial',
  page_type: 'l2-category',
  target_url: '/categories/bags-accessories/backpacks',
  target_status: 'live',
  ontology_slug: 'backpacks',
  brand_count: 28,
  data_quality: 'pass',
  intent_fit: 3,
  differentiation: 3,
  priority: 'P0',
  eligibility: 'launch',
  composite: 'none',
  content_requirement: 'intro + 3 FAQ + curated top-10',
  indexability: 'index',
  locale: 'zh-TW',
  notes: '',
} as const

describe('keyword ownership registry', () => {
  it('parses a valid l2 cluster', () => {
    const cluster: KeywordCluster = keywordClusterSchema.parse(backpackCluster)

    expect(cluster.id).toBe('l2-backpacks')
    expect(cluster.primary_keyword).toBe('台灣後背包品牌')
    expect(cluster.secondary_keywords).toEqual(['後背包推薦', '台灣製後背包'])
    expect(cluster.ontology_slug).toBe('backpacks')
    expect(cluster.brand_count).toBe(28)
    expect(cluster.priority).toBe('P0')
    expect(cluster.target_url).toBe('/categories/bags-accessories/backpacks')
  })

  it('rejects an l2 row missing ontology_slug', () => {
    const { ontology_slug: _omitted, ...withoutSlug } = backpackCluster

    expect(() => keywordClusterSchema.parse(withoutSlug)).toThrow(/ontology_slug/)
  })

  it('allows a story row without ontology_slug', () => {
    const { ontology_slug: _omitted, ...rest } = backpackCluster
    const storyRow = keywordClusterSchema.parse({
      ...rest,
      id: 'story-taiwan-leather-workshops',
      primary_keyword: '台灣皮件工坊故事',
      page_type: 'story',
      target_url: '/stories/taiwan-leather-workshops',
      target_status: 'proposed',
      content_requirement: 'long-form narrative + 2 FAQ',
    })

    expect(storyRow.ontology_slug).toBeUndefined()
    expect(storyRow.page_type).toBe('story')
  })

  it('rejects an unknown page_type', () => {
    expect(() =>
      keywordClusterSchema.parse({ ...backpackCluster, page_type: 'landing-page' }),
    ).toThrow(/page_type/)
  })

  it('derivePriority buckets by brand_count, intent_fit and differentiation', () => {
    const top = derivePriority({ brand_count: 28, intent_fit: 3, differentiation: 3 })
    expect(top).toBe('P0')

    const fewerBrands = derivePriority({ brand_count: 12, intent_fit: 3, differentiation: 3 })
    const weakerIntent = derivePriority({ brand_count: 28, intent_fit: 2, differentiation: 3 })
    const weakerDifferentiation = derivePriority({
      brand_count: 28,
      intent_fit: 3,
      differentiation: 2,
    })

    for (const lowered of [fewerBrands, weakerIntent, weakerDifferentiation]) {
      expect(lowered).not.toBe('P0')
      expect(lowered).toBe('P1')
    }

    expect(derivePriority({ brand_count: 12, intent_fit: 2, differentiation: 1 })).toBe('P2')
    expect(derivePriority({ brand_count: 6, intent_fit: 2, differentiation: 1 })).toBe('P3')
    expect(derivePriority({ brand_count: 2, intent_fit: 1, differentiation: 1 })).toBe('P3')
  })

  it('rejects a multi-intent composite marked launch', () => {
    expect(() =>
      keywordClusterSchema.parse({
        ...backpackCluster,
        id: 'l2-backpacks-multi',
        composite: 'multi-intent',
        eligibility: 'launch',
      }),
    ).toThrow(/multi-intent/)
  })

  it('allows a synonym composite marked launch', () => {
    const cluster = keywordClusterSchema.parse({
      ...backpackCluster,
      id: 'l2-backpacks-synonym',
      composite: 'synonym',
      eligibility: 'launch',
    })

    expect(cluster.composite).toBe('synonym')
    expect(cluster.eligibility).toBe('launch')
  })

  it('loadKeywordMap surfaces the file path on a parse failure', () => {
    const file = writeTempYaml(
      [
        'version: 1',
        'generated_at: 2026-08-06',
        'clusters:',
        '  - id: l2-backpacks',
        '    primary_keyword: 台灣後背包品牌',
        '    page_type: l2-category',
        'unmapped_backlog: []',
        '',
      ].join('\n'),
    )

    expect(() => loadKeywordMap(file)).toThrow(new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  })

  it('loads a well-formed keyword map document', () => {
    const file = writeTempYaml(
      [
        'version: 1',
        'generated_at: 2026-08-06',
        'clusters:',
        '  - id: l2-backpacks',
        '    primary_keyword: 台灣後背包品牌',
        '    secondary_keywords: [後背包推薦, 台灣製後背包]',
        '    search_intent: commercial',
        '    page_type: l2-category',
        '    target_url: /categories/bags-accessories/backpacks',
        '    target_status: live',
        '    ontology_slug: backpacks',
        '    brand_count: 28',
        '    data_quality: pass',
        '    intent_fit: 3',
        '    differentiation: 3',
        '    priority: P0',
        '    eligibility: launch',
        '    composite: none',
        '    content_requirement: intro + 3 FAQ + curated top-10',
        '    indexability: index',
        '    locale: zh-TW',
        "    notes: ''",
        'unmapped_backlog:',
        '  - slug: enamel-pins',
        '    brand_count: 3',
        '    composite: none',
        "    notes: 'too few brands to justify a page'",
        '',
      ].join('\n'),
    )

    const map = loadKeywordMap(file)
    const [first] = map.clusters

    expect(map.clusters).toHaveLength(1)
    expect(first?.ontology_slug).toBe('backpacks')
    expect(map.unmapped_backlog.at(0)?.slug).toBe('enamel-pins')
  })
})
