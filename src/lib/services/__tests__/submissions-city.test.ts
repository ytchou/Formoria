import { describe, expect, it } from 'vitest'
import { buildSubmissionRecord } from '@/lib/services/submissions'

describe('buildSubmissionRecord city mapping', () => {
  it('includes city in the submission record payload', () => {
    const row = buildSubmissionRecord({
      brandId: 'brand-123',
      brandName: '城市品牌',
      submitterEmail: 'submitter@example.com',
      city: 'taipei',
    })

    expect(row).toMatchObject({
      brand_id: 'brand-123',
      brand_name: '城市品牌',
      submitter_email: 'submitter@example.com',
      city: 'taipei',
    })
  })

  it('preserves an explicit null city value', () => {
    const row = buildSubmissionRecord({
      brandName: '城市品牌',
      submitterEmail: 'submitter@example.com',
      city: null,
    })

    expect(row.city).toBeNull()
  })
})
