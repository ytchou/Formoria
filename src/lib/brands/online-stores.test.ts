import { describe, expect, it } from 'vitest'
import {
  ONLINE_STORES,
  onlineStoreByColumn,
  onlineStoreByPlatformSlug,
  onlineStoreForUrl,
} from './online-stores'

describe('online-stores registry', () => {
  it('keeps website first in the registry', () => {
    // ORDER INVARIANT. `src/lib/json-ld.ts`, `src/lib/brands/link-fallback.ts`
    // and `src/lib/services/link-enrichment.ts` all read this order as
    // priority, so a reorder silently changes which link a brand publishes.
    expect(ONLINE_STORES.at(0)?.key).toBe('website')
    expect(ONLINE_STORES.at(-1)?.key).toBe('myship')
  })

  it('rejects duplicate column, camel field, or platform slug', () => {
    // The invariant that is NOT free by construction. `indexBy` keeps the LAST
    // entry for a repeated key, so a duplicated `column` or `platformSlug` in
    // the registry silently collapses two stores into one lookup -- the
    // earlier store becomes unreachable through the map while both still
    // appear in the array, and no type catches it.
    const columns = ONLINE_STORES.map((store) => store.column)
    const camelFields = ONLINE_STORES.map((store) => store.camel)
    const platformSlugs = ONLINE_STORES.map((store) => store.platformSlug)

    expect(new Set(columns).size).toBe(ONLINE_STORES.length)
    expect(new Set(camelFields).size).toBe(ONLINE_STORES.length)
    expect(new Set(platformSlugs).size).toBe(ONLINE_STORES.length)

    // Therefore neither lookup map lost an entry to a collision.
    expect(Object.keys(onlineStoreByColumn)).toHaveLength(ONLINE_STORES.length)
    expect(Object.keys(onlineStoreByPlatformSlug)).toHaveLength(ONLINE_STORES.length)
  })

  it('resolves a URL to its online store', () => {
    expect(onlineStoreForUrl('https://www.pinkoi.com/store/some-seller')?.key).toBe('pinkoi')
    expect(onlineStoreForUrl('https://shopee.tw/someshop')?.key).toBe('shopee')
    expect(
      onlineStoreForUrl('https://myship.7-11.com.tw/general/detail/GM2205195798303')?.key,
    ).toBe('myship')

    // The myship store route is not a storefront detail page.
    expect(
      onlineStoreForUrl('https://myship.7-11.com.tw/general/store/GM2205195798303'),
    ).toBeNull()
    // The 7-11 e-tracking host is a different host entirely.
    expect(onlineStoreForUrl('https://eservice.7-11.com.tw/e-tracking/GM2205195798303')).toBeNull()

    // `website` is pattern-less by design: it is the fallback bucket a caller
    // falls into when this returns null, never a match target.
    expect(onlineStoreForUrl('https://brand.example.com/shop')).toBeNull()
    expect(
      ONLINE_STORES.filter((store) => store.urlPattern !== null).map((store) => store.key),
    ).not.toContain('website')
  })
})
