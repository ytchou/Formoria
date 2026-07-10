import { expect, it } from 'vitest'
import { buildImageQueryVariants } from './search'

it('builds single query with brand name, product type, and negative terms', () => {
  const variants = buildImageQueryVariants({
    brandName: '好日子', productType: 'lifestyle', purchaseWebsite: 'https://agooday.com/products',
  })
  expect(variants).toHaveLength(1)
  expect(variants[0]).toContain('"好日子"')
  expect(variants[0]).toContain('lifestyle')
  expect(variants[0]).toContain('-優惠')
  expect(variants[0]).toContain('-coupon')
})
