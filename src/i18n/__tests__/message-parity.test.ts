import { describe, expect, it } from 'vitest'

import { L1_CATEGORIES, L2_SUBCATEGORIES } from '@/lib/taxonomy/ontology'
import en from '../../../messages/en.json'
import zhTW from '../../../messages/zh-TW.json'

/**
 * The ONLY namespace exempt from cross-locale parity. `/admin` is English-pinned
 * at two independent points — `ADMIN_DEFAULT_LOCALE = 'en'` in `src/proxy.ts`
 * and the hardcoded `getMessages({ locale: 'en' })` in
 * `src/app/admin/layout.tsx` — so a zh-TW admin catalogue is never rendered.
 * Keeping one would be 376 strings that no reader ever sees and every new admin
 * key would have to be translated twice to keep this test green.
 *
 * Scoped to this prefix deliberately: a blanket skip would let a genuinely
 * user-facing namespace drift untranslated without any test noticing.
 */
const EN_ONLY_PREFIX = 'admin.'

/** Flattens a message catalogue to dotted key paths. Array entries become indexed
 * paths (`foo.0`) so a length mismatch between locales is caught too. */
function flatten(node: unknown, prefix = '', keys: string[] = []): string[] {
  if (typeof node !== 'object' || node === null) {
    keys.push(prefix)
    return keys
  }

  for (const [key, value] of Object.entries(node)) {
    flatten(value, prefix ? `${prefix}.${key}` : key, keys)
  }

  return keys
}

function isEnOnly(key: string): boolean {
  return key === 'admin' || key.startsWith(EN_ONLY_PREFIX)
}

/** Every string leaf in a catalogue, paired with the dotted path that reaches
 * it. `flatten` above answers "which keys exist"; this answers "what do they
 * say", which is what a vocabulary lock has to read. */
function stringEntries(
  node: unknown,
  prefix = '',
  entries: [string, string][] = [],
): [string, string][] {
  if (typeof node === 'string') {
    entries.push([prefix, node])
    return entries
  }
  if (typeof node !== 'object' || node === null) return entries

  for (const [key, value] of Object.entries(node)) {
    stringEntries(value, prefix ? `${prefix}.${key}` : key, entries)
  }

  return entries
}

/**
 * The vocabulary the product retired. Formoria names exactly two things: a
 * physical place that carries a brand is 實體通路 (stockist), and a place to buy
 * online is 線上購買 (online store). The umbrella — "channel" / 通路 on its own —
 * is gone, because it made one word stand for a shop, a marketplace listing, a
 * distributor, and a brand's own website at once.
 *
 * Each entry below was a real string on a live surface, so a hit here is not a
 * style nit: it is a reader being handed a second name for something the rest of
 * the site already named.
 */
const RETIRED_VOCABULARY = [
  '販售地點',
  '購買通路',
  '購買管道',
  '銷售通路',
  '銷售管道',
  '據點',
  '門市',
  '實體店',
  '經銷',
] as const

/**
 * 哪裡買 is deliberately NOT retired. It is a search-intent phrase people type,
 * not a label Formoria uses for the concept — `{品牌名} 哪裡買` is a P0 secondary
 * keyword in `content/seo/keyword-map.yaml` on the `brand-detail-template`, which
 * covers every live brand page. Nothing else in CI enforces its survival, so the
 * assertion below states it positively rather than trusting a reviewer to notice
 * a deletion.
 */
const SEARCH_INTENT_KEYS = [
  'nav.whereToBuy',
  'footer.whereToBuy',
  'whereToBuy.metaTitle',
  'whereToBuy.indexTitle',
  'whereToBuy.cityTitle',
  'whereToBuy.directory',
]

describe('message catalogue parity', () => {
  it('owns trail card labels in the trails namespace', () => {
    const oldEyebrowKey = ['trail', 'Eyebrow'].join('')
    const oldCtaKey = ['trail', 'Cta'].join('')

    for (const catalogue of [zhTW, en]) {
      expect(catalogue.landing.trails).toHaveProperty('eyebrow')
      expect(catalogue.landing.trails).toHaveProperty('cta')
      expect(catalogue.landing.selectedProducts).not.toHaveProperty(oldEyebrowKey)
      expect(catalogue.landing.selectedProducts).not.toHaveProperty(oldCtaKey)
    }
  })

  it('en and zh-TW have identical key sets outside the admin namespace', () => {
    const enKeys = new Set(flatten(en).filter((key) => !isEnOnly(key)))
    const zhKeys = new Set(flatten(zhTW).filter((key) => !isEnOnly(key)))

    const missingInZh = [...enKeys].filter((key) => !zhKeys.has(key)).sort()
    const missingInEn = [...zhKeys].filter((key) => !enKeys.has(key)).sort()

    expect({ missingInZh, missingInEn }).toEqual({
      missingInZh: [],
      missingInEn: [],
    })
  })

  it('still compares a substantial catalogue, so the exemption cannot hollow the test out', () => {
    const compared = flatten(en).filter((key) => !isEnOnly(key))

    // Guards against a future refactor that accidentally widens the exemption:
    // if this number collapses, the parity assertion above has stopped meaning
    // anything even though it still passes.
    expect(compared.length).toBeGreaterThan(1000)
  })

  it('keeps the admin namespace intentionally English-only', () => {
    expect(en).toHaveProperty('admin')
    expect(zhTW).not.toHaveProperty('admin')
    expect(flatten(zhTW).filter(isEnOnly)).toEqual([])
  })

  it('exempts nothing but the admin namespace', () => {
    const exempted = flatten(en).filter(isEnOnly)

    expect(exempted.length).toBeGreaterThan(0)
    expect(exempted.every((key) => key.startsWith(EN_ONLY_PREFIX))).toBe(true)
  })

  it('calls the /discover surface one name everywhere', () => {
    /*
     * ONE NAME FOR ONE THING. The nav link, the footer link, the page's own
     * `<h1>`, its `<title>`, and the breadcrumb crumb that also feeds the
     * BreadcrumbList JSON-LD all point at `/discover`, so they must all say the
     * same word. They did not: the nav said 風格 (DESIGN.md, decision D5/D10)
     * while the pages themselves still said 主題選物, which is a reader
     * following a link to a page that claims to be somewhere else — and, in the
     * JSON-LD, a machine-readable disagreement.
     *
     * Pinned as an equality against `nav.discover` rather than against the
     * literal, so renaming the concept once is still a one-line change.
     */
    for (const catalogue of [zhTW, en]) {
      const name = catalogue.nav.discover

      expect(catalogue.footer.discover).toBe(name)
      expect(catalogue.discover.heading).toBe(name)
      expect(catalogue.discover.metaTitle).toBe(name)
      expect(catalogue.discover.breadcrumb).toBe(name)
    }

    // The zh-TW word is the one DESIGN.md §7 and decision D5/D10 name, stated
    // once here so a rename has to be deliberate rather than incidental.
    expect(zhTW.nav.discover).toBe('風格')
  })

  it('retired the 主題選物 vocabulary from the discover namespace', () => {
    // The section had two names in one product. Every string the reader sees on
    // `/discover` and `/discover/[slug]` now uses the 風格 vocabulary; a hit
    // here means a page has drifted back to the old name.
    const stale: string[] = []
    const walk = (node: unknown, path: string) => {
      if (typeof node === 'string') {
        if (node.includes('主題選物')) stale.push(path)
        return
      }
      if (typeof node !== 'object' || node === null) return
      for (const [key, value] of Object.entries(node)) {
        walk(value, path ? `${path}.${key}` : key)
      }
    }
    walk(zhTW.discover, 'discover')

    expect(stale).toEqual([])
  })

  it('retires the channel vocabulary from every namespace', () => {
    // Both catalogues, every namespace: the retired words were spread across
    // nine of them (品牌頁, 儀表板, 推薦流程, 常見問題, 關於, 開始使用, 功能建議,
    // 品牌目錄, 哪裡買), which is exactly why a per-surface review kept missing
    // them and a catalogue-wide assertion is the only thing that holds.
    const stale: string[] = []
    for (const [locale, catalogue] of [
      ['zh-TW', zhTW],
      ['en', en],
    ] as const) {
      for (const [path, value] of stringEntries(catalogue)) {
        const term = RETIRED_VOCABULARY.find((retired) =>
          value.includes(retired),
        )
        if (term) stale.push(`${locale}:${path} says ${term}`)
      }
    }

    expect(stale).toEqual([])
  })

  it('keeps 哪裡買 as the search-intent phrase', () => {
    const values = Object.fromEntries(stringEntries(zhTW))
    const missing = SEARCH_INTENT_KEYS.filter(
      (key) => !values[key]?.includes('哪裡買'),
    )

    // A find-and-replace that swept 哪裡買 along with the retired words would
    // pass every other test in this file while dropping a keyword that ranks on
    // hundreds of live pages.
    expect(missing).toEqual([])
  })

  it('names the offline concept 實體通路 and the online concept 線上購買', () => {
    const values = stringEntries(zhTW).map(([, value]) => value)

    // The other half of the lock: retiring the old words is only half a rename
    // if the new ones never arrive.
    expect(values.some((value) => value.includes('實體通路'))).toBe(true)
    expect(values.some((value) => value.includes('線上購買'))).toBe(true)

    // Pinned on the two surfaces the reader meets the concepts on — the brand
    // page's on-page nav and its purchase-links section — so renaming either
    // concept has to be deliberate rather than incidental.
    expect(zhTW.brandDetail.tabNav.locations).toBe('實體通路')
    expect(zhTW.brandDetail.links.onlineStores).toBe('線上購買')
  })

  it('categories.l1 has the same launch-copy keys in both locales', () => {
    expect(Object.keys(zhTW.categories.l1).sort()).toEqual(
      Object.keys(en.categories.l1).sort(),
    )
    // 10 after the kids/pets split, 9 after DEV-1507 retired `crafts`:
    // `kids-pets` became `kids`, and `pets` ships `eligibility: defer-brands` —
    // a correct node held below the supply bar, which is not a launch page.
    expect(Object.keys(zhTW.categories.l1)).toHaveLength(9)
  })

  it('message_parity_holds_for_new_taxonomy_keys', () => {
    // Both locales or neither. A key added on one side renders the raw key path
    // to the other locale's readers, and next-intl does not fail the build.
    expect(Object.keys(zhTW.categories.descriptions).sort()).toEqual(
      Object.keys(en.categories.descriptions).sort(),
    )
    expect(Object.keys(zhTW.categories.l1).sort()).toEqual(
      Object.keys(en.categories.l1).sort(),
    )
    expect(Object.keys(zhTW.categories.l2).sort()).toEqual(
      Object.keys(en.categories.l2).sort(),
    )

    // `kids` and `pets` replaced `kids-pets` on every taxonomy block.
    for (const block of [zhTW.categories, en.categories]) {
      expect(block.descriptions).not.toHaveProperty('kids-pets')
      expect(block.l1).not.toHaveProperty('kids-pets')
    }

    // Every L1 launch-copy key names a live L1, and every L2 landing-copy key
    // names a live L2 — a key left behind after a slug moves is dead copy that
    // no route can reach.
    const l1Slugs = new Set<string>(L1_CATEGORIES.map(category => category.slug))
    const l2Slugs = new Set<string>(L2_SUBCATEGORIES.map(sub => sub.slug))
    expect(Object.keys(zhTW.categories.l1).filter(key => !l1Slugs.has(key))).toEqual([])
    expect(Object.keys(zhTW.categories.l2).filter(key => !l2Slugs.has(key))).toEqual([])
  })

  it('message_parity_holds_without_a_materials_block', () => {
    // DEV-1525 moved the material labels into `MATERIALS` in the ontology, where
    // the slug is the key and the labels ride along. A `categories.materials`
    // block returning here would be a second, un-generated source of truth that
    // no test compares against the stored vocabulary.
    expect(zhTW.categories).not.toHaveProperty('materials')
    expect(en.categories).not.toHaveProperty('materials')

    expect(Object.keys(zhTW.categories).sort()).toEqual(Object.keys(en.categories).sort())
  })

  it('en_messages_carry_no_han_keys', () => {
    // A Han key path is the zh-as-identifier shape the slug migration retires:
    // it forces English readers to look a term up by its Chinese name, and it is
    // unreachable from a URL. `categories.materials` was the last one.
    const hanKeys = flatten(en.categories).filter(key => /[\u4e00-\u9fff]/.test(key))
    expect(hanKeys).toEqual([])
  })

  it('llms_txt_has_a_description_for_every_l1', () => {
    // `formatLlmsTxt` omits a missing description rather than printing
    // "undefined" (`llms.txt/route.ts:26-27`), so a gap here is invisible in the
    // output — the AI-crawler surface just loses a line.
    expect(L1_CATEGORIES).toHaveLength(12)

    const missing: string[] = []
    for (const category of L1_CATEGORIES) {
      const key = category.slug as keyof typeof en.categories.descriptions
      const zh = zhTW.categories.descriptions[key]
      const english = en.categories.descriptions[key]
      if (!zh || !english) missing.push(category.slug)
    }
    expect(missing, `L1s with no llms.txt description: ${missing.join(', ')}`).toEqual([])

    // The reverse direction: a description for a slug that is no longer an L1
    // would be published under a URL that 404s.
    const l1Slugs = new Set<string>(L1_CATEGORIES.map(category => category.slug))
    expect(
      Object.keys(en.categories.descriptions).filter(slug => !l1Slugs.has(slug)),
    ).toEqual([])
  })

  it('keeps the subMetadata fallback for non-indexable subcategories', () => {
    expect(zhTW.categories.subMetadata).toMatchObject({
      title: expect.any(String),
      description: expect.any(String),
    })
    expect(en.categories.subMetadata).toMatchObject({
      title: expect.any(String),
      description: expect.any(String),
    })
  })
})
