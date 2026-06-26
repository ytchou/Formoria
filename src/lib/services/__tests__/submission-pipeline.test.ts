import { it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { submitBrandForReview } from '../submission-pipeline'
import { describeWithDb } from '@/test/setup'

const supabase =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      )
    : null

describeWithDb('submitBrandForReview (submission-first)', () => {
  const testBrandName = '[TEST-SUBMIT] Pipeline Brand'

  afterEach(async () => {
    await supabase!.from('brand_submissions').delete().eq('brand_name', testBrandName)
    await supabase!.from('brands').delete().eq('name', testBrandName)
  })

  it('creates only a brand_submissions record with brand_id=null', async () => {
    const result = await submitBrandForReview({
      brandName: testBrandName,
      websiteUrl: 'https://test-submit.example.com',
      submitterEmail: 'submitter@example.com',
      submitterName: 'Test Submitter',
      isBrandOwner: false,
      pdpaConsent: true,
    })

    expect(result.submissionId).toBeDefined()

    const { data: submission } = await supabase!
      .from('brand_submissions')
      .select('*')
      .eq('id', result.submissionId)
      .single()

    expect(submission).toBeDefined()
    expect(submission!.brand_id).toBeNull()
    expect(submission!.status).toBe('pending')
    expect(submission!.brand_name).toBe(testBrandName)

    const { data: brands } = await supabase!
      .from('brands')
      .select('id')
      .eq('name', testBrandName)

    expect(brands).toHaveLength(0)
  })

  it('returns submission ID without a brand slug', async () => {
    const result = await submitBrandForReview({
      brandName: testBrandName,
      websiteUrl: 'https://test-submit.example.com',
      submitterEmail: 'submitter@example.com',
      submitterName: 'Test Submitter',
      isBrandOwner: true,
      pdpaConsent: true,
    })

    expect(result.submissionId).toBeDefined()
    expect(result.brandSlug).toBeUndefined()
  })
})
