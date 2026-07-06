import { expect, it } from 'vitest'
import { buildImageQueryVariants } from './search'

it('builds quoted brand+product-type, site-scoped, and negative-term variants', () => {
  const variants = buildImageQueryVariants({
    brandName: '好日子', productType: 'lifestyle', purchaseWebsite: 'https://agooday.com/products',
  })
  expect(variants[0]).toContain('"好日子"')
  expect(variants[0]).toContain('lifestyle')
  expect(variants.some((v) => v.includes('site:agooday.com'))).toBe(true)
  expect(variants.every((v) => v.includes('-優惠') && v.includes('-coupon'))).toBe(true)
  expect(variants.length).toBeLessThanOrEqual(3)
})
