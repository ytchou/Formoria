import { describe, expect, it } from 'vitest'

import en from '../../../messages/en.json'
import zhTW from '../../../messages/zh-TW.json'

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

describe('message catalogue parity', () => {
  it('en and zh-TW have identical key sets', () => {
    const enKeys = new Set(flatten(en))
    const zhKeys = new Set(flatten(zhTW))

    const missingInZh = [...enKeys].filter((key) => !zhKeys.has(key)).sort()
    const missingInEn = [...zhKeys].filter((key) => !enKeys.has(key)).sort()

    expect({ missingInZh, missingInEn }).toEqual({
      missingInZh: [],
      missingInEn: [],
    })
  })
})
