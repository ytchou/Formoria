import { describe, expect, it } from 'vitest'
import {
  PURCHASE_CAMEL_FIELDS,
  PURCHASE_CHANNELS,
  PURCHASE_COLUMNS,
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

  it('PURCHASE_COLUMNS and PURCHASE_CAMEL_FIELDS stay index-aligned', () => {
    expect(PURCHASE_COLUMNS).toHaveLength(PURCHASE_CAMEL_FIELDS.length)
    expect(PURCHASE_COLUMNS).toHaveLength(PURCHASE_CHANNELS.length)
    PURCHASE_CHANNELS.forEach((channel, index) => {
      expect(PURCHASE_COLUMNS[index]).toBe(channel.column)
      expect(PURCHASE_CAMEL_FIELDS[index]).toBe(channel.camel)
    })
  })

  it('purchaseChannelByColumn and purchaseChannelByPlatformSlug round-trip', () => {
    for (const channel of PURCHASE_CHANNELS) {
      expect(purchaseChannelByColumn[channel.column]).toBe(channel)
      expect(purchaseChannelByPlatformSlug[channel.platformSlug]).toBe(channel)
      expect(purchaseChannelByColumn[channel.column]).toBe(
        purchaseChannelByPlatformSlug[channel.platformSlug]
      )
    }
  })
})
