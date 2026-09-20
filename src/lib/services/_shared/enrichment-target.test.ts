import { describe, expect, it } from 'vitest'

import {
  brandTarget,
  targetImageStorage,
  type EnrichmentTarget,
} from './enrichment-target'

describe('targetImageStorage', () => {
  it('stores brand enrichment in the public image bucket', () => {
    expect(targetImageStorage(brandTarget('brand-id'))).toEqual({
      table: 'brand_images',
      foreignKey: 'brand_id',
      prefix: 'brands',
      bucket: 'brand-images',
    })
  })

  it('stores submission enrichment in the private submission bucket', () => {
    const target: EnrichmentTarget = {
      type: 'submission',
      id: 'submission-id',
    }

    expect(targetImageStorage(target)).toEqual({
      table: 'submission_images',
      foreignKey: 'submission_id',
      prefix: 'submissions',
      bucket: 'brand-submissions',
    })
  })
})
