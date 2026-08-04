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

  it('purchaseChannelForUrl returns null for an unmatched host', () => {
    expect(purchaseChannelForUrl('https://brand.example.com/shop')).toBeNull()
  })

  it('PURCHASE_CHANNELS order places website first', () => {
    expect(PURCHASE_CHANNELS[0].key).toBe('website')
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
