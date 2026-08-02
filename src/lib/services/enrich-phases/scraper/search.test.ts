import { describe, expect, it } from 'vitest'
import { buildImageQueryVariants } from './search'
import { passesImageDimensions } from './serper'

describe('buildImageQueryVariants', () => {
  it('builds a single query from quoted brand name, Chinese product type, and 商品', () => {
    const variants = buildImageQueryVariants({ brandName: '好日子', productType: 'home' })
    expect(variants).toEqual(['"好日子" 居家生活 商品'])
  })

  it('translates the product-type slug and never leaks the raw English slug', () => {
    const variants = buildImageQueryVariants({
      brandName: '瀏海樹 BANGSTREE', productType: 'bags-accessories',
    })
    expect(variants[0]).toBe('"瀏海樹 BANGSTREE" 包袋配件 商品')
    expect(variants[0]).not.toContain('bags-accessories')
  })

  it('omits the type segment when the product type is missing or unknown', () => {
    expect(buildImageQueryVariants({ brandName: '好日子' })).toEqual(['"好日子" 商品'])
    expect(buildImageQueryVariants({ brandName: '好日子', productType: null })).toEqual(['"好日子" 商品'])
    // 'lifestyle' is not an L1 slug — an unresolvable value drops out cleanly.
    expect(buildImageQueryVariants({ brandName: '好日子', productType: 'lifestyle' })).toEqual(['"好日子" 商品'])
  })

  it('carries no negative terms, 台灣, or 品牌', () => {
    const query = buildImageQueryVariants({ brandName: '好日子', productType: 'home' })[0] ?? ''
    for (const term of ['-優惠', '-折扣', '-特價', '-coupon', '台灣', '品牌']) {
      expect(query).not.toContain(term)
    }
  })

  it('returns no queries for a blank brand name', () => {
    expect(buildImageQueryVariants({ brandName: '   ' })).toEqual([])
  })

  // One query, one credit. The name is deliberately UNQUOTED: stored names are
  // bilingual concatenations, and across twelve degraded-name probes the
  // unquoted form returned a full ten every time while the quoted form thinned
  // on a reversed bilingual name. The category is deliberately absent — a third
  // constraint returned zero images for two of five brands.
  it('anchors on the brand domain with an unquoted name when a website is known', () => {
    expect(
      buildImageQueryVariants({
        brandName: '好日子',
        productType: 'home',
        purchaseWebsite: 'https://www.gooddays.tw/collections/all',
      })
    ).toEqual(['site:gooddays.tw 好日子'])
  })

  it('keeps 商品 for a brand with no website, where it is the only commerce signal', () => {
    expect(
      buildImageQueryVariants({ brandName: '好日子', productType: 'home', purchaseWebsite: null })
    ).toEqual(['"好日子" 居家生活 商品'])
  })

  it('falls back to the no-website form when the stored URL will not parse', () => {
    // A wrong site: filter returns nothing at all, so a malformed value must
    // never be guessed at.
    expect(
      buildImageQueryVariants({ brandName: '好日子', productType: 'home', purchaseWebsite: 'gooddays.tw' })
    ).toEqual(['"好日子" 居家生活 商品'])
    expect(
      buildImageQueryVariants({ brandName: '好日子', productType: 'home', purchaseWebsite: '   ' })
    ).toEqual(['"好日子" 居家生活 商品'])
  })
})

describe('passesImageDimensions', () => {
  it('judges the short edge when both dimensions are present', () => {
    expect(passesImageDimensions({ imageUrl: 'a', imageWidth: 800, imageHeight: 600 })).toBe(true)
    expect(passesImageDimensions({ imageUrl: 'a', imageWidth: 480, imageHeight: 480 })).toBe(true)
    // Banner strip: clears the floor on width alone, rejected on height.
    expect(passesImageDimensions({ imageUrl: 'a', imageWidth: 1600, imageHeight: 200 })).toBe(false)
    expect(passesImageDimensions({ imageUrl: 'a', imageWidth: 200, imageHeight: 1600 })).toBe(false)
    expect(passesImageDimensions({ imageUrl: 'a', imageWidth: 479, imageHeight: 479 })).toBe(false)
  })

  it('passes through when the provider reports no usable dimensions', () => {
    expect(passesImageDimensions({ imageUrl: 'a' })).toBe(true)
    expect(passesImageDimensions({ imageUrl: 'a', imageWidth: 0, imageHeight: 0 })).toBe(true)
    expect(passesImageDimensions({ imageUrl: 'a', imageWidth: 1600 })).toBe(true)
    expect(passesImageDimensions({ imageUrl: 'a', imageHeight: 100 })).toBe(true)
  })
})
