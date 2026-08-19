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

describe('message catalogue parity', () => {
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

  it('categories.l1 has the same launch-copy keys in both locales', () => {
    expect(Object.keys(zhTW.categories.l1).sort()).toEqual(
      Object.keys(en.categories.l1).sort(),
    )
    // Still 10 after the kids/pets split: `kids-pets` became `kids`, and `pets`
    // ships `eligibility: defer-brands` — a correct node held below the supply
    // bar, which is not a launch page.
    expect(Object.keys(zhTW.categories.l1)).toHaveLength(10)
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
    expect(L1_CATEGORIES).toHaveLength(13)

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
