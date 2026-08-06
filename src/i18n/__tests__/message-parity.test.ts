import { describe, expect, it } from 'vitest'

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
})
