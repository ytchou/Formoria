import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { createTestClient, describeWithDb } from '@/test/setup'
import { REMOVAL_REQUEST_REASON, requestBrandRemoval } from '../reports'

const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const BRAND_SLUG = `zzz-brand-removal-itest-${RUN_ID}`

let brandId = ''

describeWithDb('brand reports service (integration)', () => {
  beforeAll(async () => {
    const client = createTestClient()

    const { data: brand, error: brandError } = await client
      .from('brands')
      .insert({
        name: 'ZZZ Brand Removal Integration Brand',
        slug: BRAND_SLUG,
        description: 'Throwaway community brand for brand removal integration tests',
        status: 'approved',
      })
      .select('id')
      .single()

    if (brandError || !brand) {
      throw new Error(`Failed to insert test brand: ${brandError?.message}`)
    }

    brandId = brand.id
  })

  beforeEach(async () => {
    const client = createTestClient()
    await client.from('brand_reports').delete().eq('brand_id', brandId)
  })

  afterAll(async () => {
    const client = createTestClient()

    await client.from('brand_reports').delete().eq('brand_id', brandId)

    if (brandId) {
      await client.from('brands').delete().eq('id', brandId)
    }
  })

  it('requestBrandRemoval stores a pending removal request report', async () => {
    await requestBrandRemoval({
      brandId,
      reason: REMOVAL_REQUEST_REASON,
      message: 'This community listing should be removed at the brand owner’s request.',
    })

    const client = createTestClient()
    const { data, error } = await client
      .from('brand_reports')
      .select('brand_id, reason, notes, status')
      .eq('brand_id', brandId)

    if (error) {
      throw new Error(`Failed to read brand reports: ${error.message}`)
    }

    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({
      brand_id: brandId,
      reason: REMOVAL_REQUEST_REASON,
      notes: 'This community listing should be removed at the brand owner’s request.',
      status: 'pending',
    })
  })
})
