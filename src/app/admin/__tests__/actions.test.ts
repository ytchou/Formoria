import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { approveSubmission, rejectSubmission } from '@/lib/services/submissions'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

const supabase = createClient<Database>(supabaseUrl, serviceRoleKey)

describe('admin submission rejection', () => {
  const testBrandName = '[TEST-REJECT] Submission First Brand'
  const reviewerId = '00000000-0000-4000-8000-000000000001'

  afterEach(async () => {
    await supabase.from('brand_submissions').delete().eq('brand_name', testBrandName)
    await supabase.from('brands').delete().eq('name', testBrandName)
  })

  it('rejects a submission without touching the brands table', async () => {
    const reviewerNotes = 'Not enough product details yet'

    const { data: inserted, error: insertError } = await supabase
      .from('brand_submissions')
      .insert({
        brand_id: null,
        brand_name: testBrandName,
        submitter_email: 'reject-submission@example.com',
        status: 'pending',
      })
      .select('id')
      .single()

    expect(insertError).toBeNull()
    expect(inserted).not.toBeNull()

    await rejectSubmission(inserted!.id, reviewerId, reviewerNotes)

    const { data: submission, error: submissionError } = await supabase
      .from('brand_submissions')
      .select('status, reviewer_notes, reviewed_at, reviewed_by, brand_id')
      .eq('id', inserted!.id)
      .single()

    expect(submissionError).toBeNull()
    expect(submission).not.toBeNull()
    expect(submission!.status).toBe('rejected')
    expect(submission!.reviewer_notes).toBe(reviewerNotes)
    expect(submission!.reviewed_at).toEqual(expect.any(String))
    expect(submission!.reviewed_by).toBe(reviewerId)
    expect(submission!.brand_id).toBeNull()

    const { data: brands, error: brandsError } = await supabase
      .from('brands')
      .select('id')
      .eq('name', testBrandName)

    expect(brandsError).toBeNull()
    expect(brands).toHaveLength(0)
  })
})

describe('approveSubmissionAction (submission-first)', () => {
  const testBrandNamePrefix = '[TEST-APPROVE]'
  const reviewerId = 'admin@example.com'
  const submissionIds: string[] = []
  const brandIds: string[] = []

  afterEach(async () => {
    if (submissionIds.length > 0) {
      await supabase.from('brand_submissions').delete().in('id', submissionIds)
      submissionIds.length = 0
    }

    if (brandIds.length > 0) {
      await supabase.from('brand_taxonomy').delete().in('brand_id', brandIds)
      await supabase.from('brands').delete().in('id', brandIds)
      brandIds.length = 0
    }

    const { data: leftoverBrands } = await supabase
      .from('brands')
      .select('id')
      .like('name', `${testBrandNamePrefix}%`)

    const leftoverBrandIds = (leftoverBrands ?? []).map((brand) => brand.id)
    if (leftoverBrandIds.length > 0) {
      await supabase.from('brand_taxonomy').delete().in('brand_id', leftoverBrandIds)
      await supabase.from('brands').delete().in('id', leftoverBrandIds)
    }

    await supabase
      .from('brand_submissions')
      .delete()
      .like('brand_name', `${testBrandNamePrefix}%`)
  })

  it('creates a brand from submission fields + enriched_data on approval', async () => {
    const testBrandName = `${testBrandNamePrefix} Enriched Brand`
    const { data: inserted, error: insertError } = await supabase
      .from('brand_submissions')
      .insert({
        brand_id: null,
        brand_name: testBrandName,
        submitter_email: 'approve-enriched@example.com',
        description: 'Submission description',
        purchase_website: 'https://submission.example.com',
        social_instagram: 'submission_ig',
        status: 'pending',
        enriched_data: {
          description: 'Enriched description',
          hero_image_url: 'https://cdn.example.com/hero.jpg',
          product_photos: ['https://cdn.example.com/product-1.jpg'],
          product_type: 'crafts',
        },
      })
      .select('id')
      .single()

    expect(insertError).toBeNull()
    expect(inserted).not.toBeNull()
    submissionIds.push(inserted!.id)

    const result = await approveSubmission(supabase, inserted!.id, reviewerId)
    brandIds.push(result.brandId)

    const { data: brand, error: brandError } = await supabase
      .from('brands')
      .select('id, name, status, description, hero_image_url, product_photos, product_type, purchase_website, social_instagram')
      .eq('id', result.brandId)
      .single()

    expect(brandError).toBeNull()
    expect(brand).not.toBeNull()
    expect(brand!.name).toBe(testBrandName)
    expect(brand!.status).toBe('approved')
    expect(brand!.description).toBe('Enriched description')
    expect(brand!.hero_image_url).toBe('https://cdn.example.com/hero.jpg')
    expect(brand!.product_photos).toEqual(['https://cdn.example.com/product-1.jpg'])
    expect(brand!.product_type).toBe('crafts')
    expect(brand!.purchase_website).toBe('https://submission.example.com')
    expect(brand!.social_instagram).toBe('submission_ig')

    const { data: submission, error: submissionError } = await supabase
      .from('brand_submissions')
      .select('brand_id, status')
      .eq('id', inserted!.id)
      .single()

    expect(submissionError).toBeNull()
    expect(submission).not.toBeNull()
    expect(submission!.brand_id).toBe(result.brandId)
    expect(submission!.status).toBe('approved')
  })

  it('applies admin overrides with highest priority', async () => {
    const testBrandName = `${testBrandNamePrefix} Override Brand`
    const { data: inserted, error: insertError } = await supabase
      .from('brand_submissions')
      .insert({
        brand_id: null,
        brand_name: testBrandName,
        submitter_email: 'approve-overrides@example.com',
        description: 'Submission description',
        status: 'pending',
        enriched_data: {
          description: 'Enriched description',
          product_type: 'crafts',
        },
      })
      .select('id')
      .single()

    expect(insertError).toBeNull()
    expect(inserted).not.toBeNull()
    submissionIds.push(inserted!.id)

    const result = await approveSubmission(supabase, inserted!.id, reviewerId, {
      description: 'Admin override description',
    })
    brandIds.push(result.brandId)

    const { data: brand, error: brandError } = await supabase
      .from('brands')
      .select('description, product_type')
      .eq('id', result.brandId)
      .single()

    expect(brandError).toBeNull()
    expect(brand).not.toBeNull()
    expect(brand!.description).toBe('Admin override description')
    expect(brand!.product_type).toBe('crafts')
  })
})
