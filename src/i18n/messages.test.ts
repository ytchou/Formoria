import { describe, expect, it } from 'vitest'

import { loadMessages } from './messages'

describe('loadMessages', () => {
  it.each([
    ['en', 'My Brands'],
    ['zh-TW', '我的品牌'],
  ] as const)('resolves nav labels for the %s locale', async (locale, label) => {
    const messages = await loadMessages(locale) as { nav: { myBrands: string } }

    expect(messages.nav.myBrands).toBe(label)
  })
})
