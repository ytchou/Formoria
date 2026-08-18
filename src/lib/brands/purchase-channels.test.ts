import { describe, expect, it } from 'vitest'
import {
  PURCHASE_CHANNELS,
  purchaseChannelByColumn,
  purchaseChannelByPlatformSlug,
  purchaseChannelForUrl,
} from './purchase-channels'

describe('purchase-channels registry', () => {
  it('purchaseChannelForUrl matches a Pinkoi storefront', () => {
    expect(purchaseChannelForUrl('https://www.pinkoi.com/store/some-seller')?.key).toBe('pinkoi')
  })

  it('purchaseChannelForUrl matches a Shopee shop root', () => {
    expect(purchaseChannelForUrl('https://shopee.tw/someshop')?.key).toBe('shopee')
  })

  it('purchaseChannelForUrl matches a myship storefront detail URL', () => {
    expect(
      purchaseChannelForUrl('https://myship.7-11.com.tw/general/detail/GM2205195798303')?.key,
    ).toBe('myship')
  })

  it('purchaseChannelForUrl rejects the myship store route', () => {
    expect(
      purchaseChannelForUrl('https://myship.7-11.com.tw/general/store/GM2205195798303'),
    ).toBeNull()
  })

  it('purchaseChannelForUrl rejects the 7-11 e-tracking host', () => {
    expect(purchaseChannelForUrl('https://eservice.7-11.com.tw/e-tracking/GM2205195798303')).toBeNull()
  })

  it('purchaseChannelForUrl returns null for an unmatched host', () => {
    expect(purchaseChannelForUrl('https://brand.example.com/shop')).toBeNull()
  })

  it('PURCHASE_CHANNELS order places website first', () => {
    expect(PURCHASE_CHANNELS.at(0)?.key).toBe('website')
  })

  it('myship sorts last in PURCHASE_CHANNELS', () => {
    expect(PURCHASE_CHANNELS.at(-1)?.key).toBe('myship')
  })

  // The previous two tests here asserted index alignment between
  // PURCHASE_COLUMNS / PURCHASE_CAMEL_FIELDS and a round trip through
  // purchaseChannelByColumn. Both were true by construction: the arrays are
  // `PURCHASE_CHANNELS.map(...)` and the maps are `indexBy(PURCHASE_CHANNELS)`,
  // so they restated `Array.prototype.map` and `Object.fromEntries`.
  //
  // The invariant that is NOT free is uniqueness. `indexBy` keeps the LAST
  // entry for a repeated key, so a duplicated `column` or `platformSlug` in the
  // registry silently collapses two channels into one lookup — the earlier
  // channel becomes unreachable through the map while both still appear in the
  // array, and no type catches it.
  it('keys every channel uniquely by column, camel field, and platform slug', () => {
    const columns = PURCHASE_CHANNELS.map((channel) => channel.column)
    const camelFields = PURCHASE_CHANNELS.map((channel) => channel.camel)
    const platformSlugs = PURCHASE_CHANNELS.map((channel) => channel.platformSlug)

    expect(new Set(columns).size).toBe(PURCHASE_CHANNELS.length)
    expect(new Set(camelFields).size).toBe(PURCHASE_CHANNELS.length)
    expect(new Set(platformSlugs).size).toBe(PURCHASE_CHANNELS.length)

    // Therefore neither lookup map lost an entry to a collision.
    expect(Object.keys(purchaseChannelByColumn)).toHaveLength(
      PURCHASE_CHANNELS.length
    )
    expect(Object.keys(purchaseChannelByPlatformSlug)).toHaveLength(
      PURCHASE_CHANNELS.length
    )
  })
})
