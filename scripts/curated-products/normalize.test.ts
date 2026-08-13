import { describe, expect, it } from 'vitest'
import {
  normalizeCuratedContent,
  parseCuratedProductFile,
  type CuratedContentFile,
} from './normalize'

const PRODUCT_FILE = `
brand_slug: hanchor
products:
  - key: alpine-shell
    name_zh: 高山風衣
    name_en: Alpine Shell
    l1: fashion
    l2:
      - 外套
      - Performance Apparel
    official_url: https://hanchor.com/alpine-shell
    image_url: https://cdn.hanchor.com/alpine-shell.jpg
    image_source_url: https://hanchor.com/alpine-shell
    image_usage: permitted
    lifecycle: published
    source_checked_at: "2026-08-01T00:00:00.000Z"
    review_due_at: "2026-11-01T00:00:00.000Z"
    notes_zh: 台灣製防水透氣布料
    sources:
      - url: https://hanchor.com/alpine-shell
        source_type: official
        claim_zh: 台灣製造
        checked_at: "2026-08-01T00:00:00.000Z"
      - url: https://press.example.com/hanchor-shell
        source_type: press
`

function productFile(content: string, name = 'products/hanchor.yaml'): CuratedContentFile {
  return { name, content }
}

function selectionFile(
  content: string,
  name = 'selections/taiwan-outdoor.yaml',
): CuratedContentFile {
  return { name, content }
}

function withProduct(overrides: string): string {
  return `
brand_slug: hanchor
products:
  - key: alpine-shell
    name_zh: 高山風衣
    l1: fashion
${overrides}
`
}

describe('curated product YAML normalization', () => {
  it('parses a product file into typed rows', () => {
    const result = parseCuratedProductFile('products/hanchor.yaml', PRODUCT_FILE)

    expect(result.issues).toEqual([])
    expect(result.products).toHaveLength(1)
    expect(result.products[0]).toMatchObject({
      brandSlug: 'hanchor',
      key: 'alpine-shell',
      nameZh: '高山風衣',
      nameEn: 'Alpine Shell',
      l1: 'fashion',
      officialUrl: 'https://hanchor.com/alpine-shell',
      imageUsage: 'permitted',
      lifecycle: 'published',
      sourceCheckedAt: '2026-08-01T00:00:00.000Z',
      notesZh: '台灣製防水透氣布料',
      notesEn: null,
    })
    expect(result.sources).toHaveLength(2)
    expect(result.sources[0]).toMatchObject({
      brandSlug: 'hanchor',
      productKey: 'alpine-shell',
      url: 'https://hanchor.com/alpine-shell',
      sourceType: 'official',
      claimZh: '台灣製造',
      claimEn: null,
      checkedAt: '2026-08-01T00:00:00.000Z',
    })
    expect(result.sources[1]).toMatchObject({
      sourceType: 'press',
      url: 'https://press.example.com/hanchor-shell',
      checkedAt: null,
    })
  })

  it('rejects a product marked published without an official_url', () => {
    const result = parseCuratedProductFile(
      'products/hanchor.yaml',
      withProduct(`    lifecycle: published
    source_checked_at: "2026-08-01T00:00:00.000Z"
    sources:
      - url: https://hanchor.com/alpine-shell`),
    )

    expect(result.issues).toContainEqual({
      file: 'products/hanchor.yaml',
      productKey: 'alpine-shell',
      message: 'published requires official_url',
    })
    expect(result.products).toHaveLength(0)
  })

  it('rejects a product marked published with no source rows', () => {
    const result = parseCuratedProductFile(
      'products/hanchor.yaml',
      withProduct(`    lifecycle: published
    official_url: https://hanchor.com/alpine-shell
    source_checked_at: "2026-08-01T00:00:00.000Z"`),
    )

    expect(result.issues).toContainEqual({
      file: 'products/hanchor.yaml',
      productKey: 'alpine-shell',
      message: 'published requires at least one source',
    })
  })

  it('rejects a product marked published with no source_checked_at', () => {
    const result = parseCuratedProductFile(
      'products/hanchor.yaml',
      withProduct(`    lifecycle: published
    official_url: https://hanchor.com/alpine-shell
    sources:
      - url: https://hanchor.com/alpine-shell`),
    )

    expect(result.issues).toContainEqual({
      file: 'products/hanchor.yaml',
      productKey: 'alpine-shell',
      message: 'published requires source_checked_at',
    })
  })

  it('reports every publication-gate violation at once', () => {
    const result = parseCuratedProductFile(
      'products/hanchor.yaml',
      withProduct('    lifecycle: published'),
    )

    expect(result.issues.map((issue) => issue.message)).toEqual([
      'published requires official_url',
      'published requires at least one source',
      'published requires source_checked_at',
    ])
  })

  it('rejects an l1 value outside the 12-category list', () => {
    const result = parseCuratedProductFile(
      'products/hanchor.yaml',
      `
brand_slug: hanchor
products:
  - key: alpine-shell
    name_zh: 高山風衣
    l1: furniture
`,
    )

    expect(result.issues).toContainEqual({
      file: 'products/hanchor.yaml',
      productKey: 'alpine-shell',
      message: 'unknown l1 value: furniture',
    })
    expect(result.products).toHaveLength(0)
  })

  it('normalizes l2 tags through the shared ontology', () => {
    const result = parseCuratedProductFile(
      'products/hanchor.yaml',
      `
brand_slug: hanchor
products:
  - key: alpine-shell
    name_zh: 高山風衣
    l1: fashion
    l2:
      - 夾克
      - Performance Apparel
      - 陶瓷
      - 完全不存在的標籤
`,
    )

    expect(result.products[0]?.l2).toEqual(['outerwear', 'performance-apparel'])
    expect(result.issues.map((issue) => issue.message)).toContain(
      'l2 tag "ceramics" does not belong to l1 "fashion"',
    )
    expect(
      result.issues.some((issue) => issue.message.includes('完全不存在的標籤')),
    ).toBe(true)
  })

  it('rejects a selection referencing an unknown brand-slug/product-key pair', () => {
    const result = normalizeCuratedContent({
      productFiles: [productFile(PRODUCT_FILE)],
      selectionFiles: [
        selectionFile(`
trail_slug: taiwan-outdoor
selections:
  - product: hanchor/no-such-product
    section_key: hero
    position: 1
    rationale_zh: 理由
`),
      ],
      knownTrailSlugs: ['taiwan-outdoor'],
    })

    expect(result.selections).toHaveLength(0)
    expect(result.issues).toContainEqual({
      file: 'selections/taiwan-outdoor.yaml',
      productKey: 'hanchor/no-such-product',
      message: 'unknown product reference: hanchor/no-such-product',
    })
  })

  it('rejects a selection whose trail_slug is not in the known set', () => {
    const result = normalizeCuratedContent({
      productFiles: [productFile(PRODUCT_FILE)],
      selectionFiles: [
        selectionFile(
          `
trail_slug: ghost-trail
selections:
  - product: hanchor/alpine-shell
    section_key: hero
    position: 1
    rationale_zh: 理由
`,
          'selections/ghost-trail.yaml',
        ),
      ],
      knownTrailSlugs: ['taiwan-outdoor'],
    })

    expect(result.selections).toHaveLength(0)
    expect(result.issues).toContainEqual({
      file: 'selections/ghost-trail.yaml',
      productKey: null,
      message: 'unknown trail_slug: ghost-trail',
    })
  })

  it('normalizes a valid selection file into typed rows', () => {
    const result = normalizeCuratedContent({
      productFiles: [productFile(PRODUCT_FILE)],
      selectionFiles: [
        selectionFile(`
trail_slug: taiwan-outdoor
selections:
  - product: hanchor/alpine-shell
    section_key: hero
    position: 2
    rationale_zh: 版型俐落
    rationale_en: Clean cut
`),
      ],
      knownTrailSlugs: ['taiwan-outdoor'],
    })

    expect(result.issues).toEqual([])
    expect(result.selections).toEqual([
      {
        brandSlug: 'hanchor',
        productKey: 'alpine-shell',
        trailSlug: 'taiwan-outdoor',
        sectionKey: 'hero',
        position: 2,
        rationaleZh: '版型俐落',
        rationaleEn: 'Clean cut',
      },
    ])
  })

  /**
   * A silently coerced position is worse than a rejected one: it moves the
   * product to the front of the trail AND leaves `issues` empty, so the
   * applier's "refusing to apply content with unresolved issues" gate lets the
   * whole file through.
   */
  it.each([
    ['1.5', '1.5', 'position must be a non-negative integer: 1.5'],
    ['.nan', '.nan', 'position must be a non-negative integer: NaN'],
    ['-1', '-1', 'position must be a non-negative integer: -1'],
  ])('rejects a non-integer position (%s)', (_label, yamlValue, message) => {
    const result = normalizeCuratedContent({
      productFiles: [productFile(PRODUCT_FILE)],
      selectionFiles: [
        selectionFile(`
trail_slug: taiwan-outdoor
selections:
  - product: hanchor/alpine-shell
    section_key: hero
    position: ${yamlValue}
    rationale_zh: 理由
`),
      ],
      knownTrailSlugs: ['taiwan-outdoor'],
    })

    expect(result.selections).toHaveLength(0)
    expect(result.issues).toContainEqual({
      file: 'selections/taiwan-outdoor.yaml',
      productKey: 'hanchor/alpine-shell',
      message,
    })
  })

  it('keeps a valid integer position', () => {
    const result = normalizeCuratedContent({
      productFiles: [productFile(PRODUCT_FILE)],
      selectionFiles: [
        selectionFile(`
trail_slug: taiwan-outdoor
selections:
  - product: hanchor/alpine-shell
    section_key: hero
    position: 3
    rationale_zh: 理由
`),
      ],
      knownTrailSlugs: ['taiwan-outdoor'],
    })

    expect(result.issues).toEqual([])
    expect(result.selections[0]?.position).toBe(3)
  })

  /**
   * Membership in the known set is not the rule — one file IS one trail. Two
   * files resolving to the same trail would emit two rows sharing
   * `(product_id, trail_slug, section_key)` in one upsert batch, and Postgres
   * aborts that batch with 21000 after the product writes already committed.
   */
  it('rejects a trail_slug that disagrees with its own file name', () => {
    const result = normalizeCuratedContent({
      productFiles: [productFile(PRODUCT_FILE)],
      selectionFiles: [
        selectionFile(
          `
trail_slug: taiwan-outdoor
selections:
  - product: hanchor/alpine-shell
    section_key: hero
    position: 1
    rationale_zh: 理由
`,
          'selections/taiwan-indoor.yaml',
        ),
      ],
      // `taiwan-outdoor` IS a known trail — membership is exactly what used to
      // let this through.
      knownTrailSlugs: ['taiwan-outdoor', 'taiwan-indoor'],
    })

    expect(result.selections).toHaveLength(0)
    expect(result.issues).toContainEqual({
      file: 'selections/taiwan-indoor.yaml',
      productKey: null,
      message:
        'trail_slug "taiwan-outdoor" does not match its file name (expected "taiwan-indoor")',
    })
  })

  /**
   * `brand_slug` comes from the document BODY, not the filename, so two
   * differently-named files can declare the same `(brand_slug, key)`. The
   * per-file duplicate guard cannot see across files and both rows would reach
   * one upsert batch sharing `(brand_id, key)` — the same 21000 abort.
   */
  it('rejects the same (brand_slug, key) declared in two product files', () => {
    const duplicate = `
brand_slug: hanchor
products:
  - key: alpine-shell
    name_zh: 高山風衣（重複）
    l1: fashion
    sources:
      - url: https://elsewhere.example.com/alpine-shell
        source_type: press
`
    const result = normalizeCuratedContent({
      productFiles: [
        productFile(PRODUCT_FILE, 'products/hanchor.yaml'),
        productFile(duplicate, 'products/hanchor-extra.yaml'),
      ],
      selectionFiles: [],
      knownTrailSlugs: [],
    })

    // The first file wins; the second is reported, not silently merged.
    expect(result.products).toHaveLength(1)
    expect(result.products[0]?.nameZh).toBe('高山風衣')
    expect(result.issues).toContainEqual({
      file: 'products/hanchor-extra.yaml',
      productKey: 'alpine-shell',
      message:
        'duplicate product hanchor/alpine-shell: already declared in products/hanchor.yaml',
    })
    // Its sources are dropped with it — a source row keyed to a product that
    // was never emitted has no parent to hang from.
    expect(
      result.sources.some((row) =>
        row.url.includes('elsewhere.example.com'),
      ),
    ).toBe(false)
  })
})
