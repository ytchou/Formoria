import { createClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServiceClient } from '@/lib/supabase/server'
import * as brandWrites from '../brands'
import { processEnrichBrand, mergeEnrichPatches, mergeSubmissionEnrichedData, persistEnrichmentResults, persistSubmissionEnrichmentResults, runEnrich, needsPhase, seedEnrichedDataFromOwnerData } from '../curation-operations'
import type { CurationConfig } from '../curation-operations'
import { describeWithDb } from '@/test/setup'

vi.mock('../product-type-classifier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../product-type-classifier')>()
  return {
    ...actual,
    detectBrandsBatch: vi.fn(),
  }
})

describe('seedEnrichedDataFromOwnerData', () => {
  it('seeds enriched_data fields from owner_data', () => {
    const ownerData = {
      productType: 'bags-accessories',
      foundingYear: 2018,
      city: 'tainan',
      priceRange: 2,
      productTags: ['leather', 'handmade'],
    }
    const result = seedEnrichedDataFromOwnerData(ownerData, null)
    expect(result).toMatchObject({
      product_type: 'bags-accessories',
      founding_year: 2018,
      city: 'tainan',
      price_range: 2,
      product_tags: ['leather', 'handmade'],
    })
  })

  it('does not overwrite existing enriched_data fields', () => {
    const ownerData = {
      productType: 'bags-accessories',
      city: 'tainan',
    }
    const existingEnriched = {
      product_type: 'fashion',
      description: 'Existing description',
    }
    const result = seedEnrichedDataFromOwnerData(ownerData, existingEnriched)
    expect(result.product_type).toBe('fashion')
    expect(result.city).toBe('tainan')
    expect(result.description).toBe('Existing description')
  })

  it('returns existing enriched_data when owner_data is null', () => {
    const existing = { description: 'Hello' }
    const result = seedEnrichedDataFromOwnerData(null, existing)
    expect(result).toEqual(existing)
  })

  it('returns empty object when both are null', () => {
    const result = seedEnrichedDataFromOwnerData(null, null)
    expect(result).toEqual({})
  })
})

describe('mergeSubmissionEnrichedData', () => {
  it('replaces and caps product tag pairs instead of accumulating rerun outputs', () => {
    const result = mergeSubmissionEnrichedData(
      {
        product_tags: ['既有一', '既有二', '既有三'],
        product_tags_en: ['Existing 1', 'Existing 2', 'Existing 3'],
      },
      {
        product_tags: ['新一', '新二', '新三', '新四', '新五', '新六'],
        product_tags_en: ['New 1', 'New 2', 'New 3', 'New 4', 'New 5', 'New 6'],
      },
    )

    expect(result.product_tags).toEqual(['新一', '新二', '新三', '新四', '新五'])
    expect(result.product_tags_en).toEqual(['New 1', 'New 2', 'New 3', 'New 4', 'New 5'])
  })
})

describe('processEnrichBrand', () => {
  const baseBrand = {
    id: '1',
    slug: 'mybrand',
    display_brand_name: 'My Brand',
    social_instagram: null,
    social_threads: null,
    social_facebook: null,
    purchase_pinkoi: null,
    purchase_shopee: null,
    website_url: null,
    description: null,
    hero_image_url: null,
    product_images: [],
  }

  const scrapedData = {
    social_instagram: 'https://www.instagram.com/mybrand/',
    social_facebook: 'https://www.facebook.com/mybrand',
    description: 'A premium handcrafted brand from Taiwan specializing in leather goods',
    story: 'Founded in 2015 by artisans in Tainan',
  }

  it('enriches brand with social links from scraped data', () => {
    const result = processEnrichBrand(baseBrand, scrapedData, ['links'])
    expect(result.patches.links?.social_instagram).toBe('https://www.instagram.com/mybrand/')
  })

  it('does not write scraped description directly into patch (LLM rewrite path only)', () => {
    const result = processEnrichBrand(baseBrand, scrapedData, ['descriptions'])
    // Scraped text is junk — description is only populated via the LLM rewrite pipeline,
    // so buildTextEnrichPatch returns empty and the patch key is absent.
    expect(result.patches.descriptions).toBeUndefined()
  })

  it('omits description when phase is not requested', () => {
    const result = processEnrichBrand(baseBrand, scrapedData, ['links'])
    expect(result.patches.descriptions).toBeUndefined()
  })
})

describe('enrichment write guards', () => {
  it('persistEnrichmentResults routes through the guarded write path with source=enriched', async () => {
    const spy = vi.spyOn(brandWrites, 'updateBrand').mockResolvedValue({ skipped: [] } as never)
    await persistEnrichmentResults({} as never, [{ brandId: 'b1', patch: { city: '台南' } }], 'job-1')
    expect(spy).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ city: '台南' }),
      expect.objectContaining({ source: 'enriched', jobId: 'job-1' }),
    )
    spy.mockRestore()
  })

  it('per-field gate: brand with enriched_at set but missing description is still selected for the descriptions phase', () => {
    const brand = { brand_enriched_at: '2026-06-01', description: null, hero_image_url: 'x' }
    expect(needsPhase(brand, 'descriptions')).toBe(true)
  })

  it('selects brands that have Chinese copy but are missing required English copy', () => {
    const brand = {
      description: '既有中文品牌介紹',
      description_en: null,
      blurb_en: null,
    }

    expect(needsPhase(brand, 'descriptions')).toBe(true)
  })
})

describe('processEnrichBrand with cleanup phases', () => {
  const baseBrand = {
    id: '1',
    slug: 'test-brand',
    display_brand_name: '  ✨ My Brand ✨  ',
    name: '  ✨ My Brand ✨  ',
    status: 'approved',
    description: null,
    product_type: null,
    purchase_website: null,
  }

  it('cleans brand name and returns normalized result', () => {
    const result = processEnrichBrand(baseBrand, {}, ['clean'])
    expect(result.phases).toHaveProperty('clean')
    expect(result.phases.clean?.changed).toBe(true)
    expect(result.patch.name).toBe('My Brand')
  })

  it('preserves original name when clean phase is not requested', () => {
    const result = processEnrichBrand(baseBrand, {}, ['discover'])
    expect(result.phases).not.toHaveProperty('clean')
  })

  it('clean phase preserves already-clean names', () => {
    const cleanBrand = { ...baseBrand, name: 'Already Clean', display_brand_name: 'Already Clean' }
    const result = processEnrichBrand(cleanBrand, {}, ['clean'])
    expect(result.phases.clean?.changed).toBe(false)
    expect(result.patch).toEqual({})
  })
})

describe('descriptions phase standalone', () => {
  const baseBrand = {
    id: '1',
    slug: 'mybrand',
    display_brand_name: 'My Brand',
    social_instagram: null,
    social_threads: null,
    social_facebook: null,
    purchase_pinkoi: null,
    purchase_shopee: null,
    website_url: null,
    description: null,
    hero_image_url: null,
    product_images: [],
  }

  it('runs descriptions phase without setting product_type', () => {
    const result = processEnrichBrand(baseBrand, { snippets: ['A great brand making handmade soap'] }, ['descriptions'])
    expect(result.phases).toHaveProperty('descriptions')
    expect(result.patch).not.toHaveProperty('product_type')
  })

  it('runs descriptions phase without tags when tags is not in phases', () => {
    const result = processEnrichBrand(baseBrand, { snippets: ['A great brand making handmade soap'] }, ['descriptions'])
    expect(result.phases).toHaveProperty('descriptions')
    expect(result.phases).not.toHaveProperty('tags')
  })
})

describe('CurationConfig status filter', () => {
  it('constrains status to valid values', () => {
    const config: CurationConfig = { dryRun: true, status: 'hidden' }
    expect(config).toHaveProperty('status', 'hidden')

    const approved: CurationConfig = { dryRun: false, status: 'approved' }
    expect(approved).toHaveProperty('status', 'approved')
  })
})

describe('mergeEnrichPatches', () => {
  it('merges link and description patches into single update', () => {
    const patches = {
      links: { social_instagram: 'https://www.instagram.com/mybrand/' },
      descriptions: { description: 'A new description for the brand' },
    }
    const merged = mergeEnrichPatches(patches)
    expect(merged.social_instagram).toBe('https://www.instagram.com/mybrand/')
    expect(merged.description).toBe('A new description for the brand')
  })

  it('returns empty object when no patches', () => {
    const merged = mergeEnrichPatches({})
    expect(Object.keys(merged)).toHaveLength(0)
  })
})

describe('runEnrich detect integration', () => {
  it('applies non-brand gating — skips tier 3+4 for flagged brands', async () => {
    const { shouldSkipForNonBrand } = await import('../curation-operations')

    const detectResult = {
      isNonBrand: true,
      nonBrandReason: 'reseller',
      brandName: null,
      slug: 'some-brand',
      slugGenerated: null,
      productType: null,
      confidence: 'high' as const,
    }

    expect(shouldSkipForNonBrand(detectResult)).toBe(true)
  })

  it('does not gate brands that are not non-brands', async () => {
    const { shouldSkipForNonBrand } = await import('../curation-operations')

    const detectResult = {
      isNonBrand: false,
      nonBrandReason: null,
      brandName: null,
      slug: 'good-brand',
      slugGenerated: 'good-brand',
      productType: 'beauty',
      confidence: 'high' as const,
    }

    expect(shouldSkipForNonBrand(detectResult)).toBe(false)
  })

  it('does not gate low-confidence non-brands', async () => {
    const { shouldSkipForNonBrand } = await import('../curation-operations')

    const detectResult = {
      isNonBrand: true,
      nonBrandReason: 'maybe reseller',
      brandName: null,
      slug: 'uncertain-brand',
      slugGenerated: null,
      productType: null,
      confidence: 'low' as const,
    }

    expect(shouldSkipForNonBrand(detectResult)).toBe(false)
  })
})

const supabase =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      )
    : null

const serviceSupabase =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createServiceClient()
    : null

describeWithDb("runEnrich submissions mode", () => {
  let testSubmissionId: string | null = null
  let testBrandId: string | null = null

  beforeEach(async () => {
    const { data: submission, error } = await serviceSupabase!
      .from("brand_submissions")
      .insert({
        brand_name: "[TEST-RUN-ENRICH-SUB] Brand",
        submitter_email: "run-enrich-sub@example.com",
        website_url: "https://test-run-enrich-sub.example.com",
        social_instagram: "https://instagram.com/testrunenrichsub",
        status: "pending",
        brand_id: null,
      })
      .select("id")
      .single()

    if (error) {
      throw error
    }

    testSubmissionId = submission!.id
  })

  afterEach(async () => {
    if (testSubmissionId) {
      await serviceSupabase!.from("brand_submissions").delete().eq("id", testSubmissionId)
      testSubmissionId = null
    }

    if (testBrandId) {
      await serviceSupabase!.from("brands").delete().eq("id", testBrandId)
      testBrandId = null
    }
  })

  it("should target submissions when no slugs provided", async () => {
    const result = await runEnrich({ dryRun: true, phases: ["discover"] }, serviceSupabase!)

    expect(result.processed).toBeGreaterThanOrEqual(0)
  })

  it("should filter by submissionIds when provided", async () => {
    const result = await runEnrich(
      {
        target: "submissions",
        submissionIds: [testSubmissionId!],
        dryRun: true,
        phases: ["discover"],
      },
      serviceSupabase!
    )

    expect(result.processed).toBe(1)
  })

  it("should rerun explicitly selected pending submissions with brand_id set", async () => {
    const { data: brand, error } = await serviceSupabase!
      .from("brands")
      .insert({
        name: "[TEST-RUN-ENRICH-SUB] Linked Brand",
        slug: `test-run-enrich-sub-${testSubmissionId}`,
        status: "hidden",
      })
      .select("id")
      .single()

    if (error) {
      throw error
    }

    testBrandId = brand!.id

    const { error: updateError } = await serviceSupabase!
      .from("brand_submissions")
      .update({ brand_id: testBrandId })
      .eq("id", testSubmissionId!)

    if (updateError) {
      throw updateError
    }

    const result = await runEnrich(
      {
        target: "submissions",
        submissionIds: [testSubmissionId!],
        dryRun: true,
        phases: [],
      },
      serviceSupabase!
    )

    expect(result.processed).toBe(1)
  })

  it("should default to brands mode when slugs provided", async () => {
    const result = await runEnrich(
      {
        slugs: ["some-brand"],
        dryRun: true,
        phases: ["discover"],
      },
      serviceSupabase!
    )

    expect(result.processed).toBe(0)
  })
})

describeWithDb('runEnrich persist routing', () => {
  const testBrandName = '✨ [TEST] Persist Routing ✨'
  let testSubmissionId: string | null = null

  beforeEach(async () => {
    const { data: submission, error } = await serviceSupabase!
      .from('brand_submissions')
      .insert({
        brand_name: testBrandName,
        website_url: 'https://test-persist-routing.example.com',
        status: 'pending',
        submitter_email: 'persist-routing@example.com',
        submitter_name: 'Persist Routing Tester',
        is_brand_owner: false,
        brand_id: null,
      })
      .select('id')
      .single()

    if (error) {
      throw error
    }

    testSubmissionId = submission!.id
  })

  afterEach(async () => {
    if (testSubmissionId) {
      await serviceSupabase!.from('brand_submissions').delete().eq('id', testSubmissionId)
      testSubmissionId = null
    }

    await serviceSupabase!.from('brands').delete().eq('name', testBrandName)
  })

  it('should write enriched_data to submission, not brands table', async () => {
    await runEnrich(
      {
        dryRun: false,
        target: 'submissions',
        submissionIds: [testSubmissionId!],
        phases: ['clean'],
      },
      serviceSupabase!
    )

    const { data: submission } = await serviceSupabase!
      .from('brand_submissions')
      .select('enriched_data')
      .eq('id', testSubmissionId!)
      .single()

    const { data: brand } = await serviceSupabase!
      .from('brands')
      .select('id')
      .eq('name', testBrandName)
      .maybeSingle()

    expect(submission!.enriched_data).not.toBeNull()
    expect(brand).toBeNull()
  })

  it('should record submissionId in BrandOutcome', async () => {
    const progressTargetIds: string[] = []
    const result = await runEnrich(
      {
        dryRun: false,
        target: 'submissions',
        submissionIds: [testSubmissionId!],
        phases: ['clean'],
        onTargetProgress: (event) => {
          progressTargetIds.push(event.targetId)
        },
      },
      serviceSupabase!
    )

    expect(result.brandOutcomes.some((outcome) => outcome.submissionId === testSubmissionId)).toBe(true)
    expect(progressTargetIds).not.toHaveLength(0)
    expect(progressTargetIds.every((targetId) => targetId === testSubmissionId)).toBe(true)
  })
})

describeWithDb('enrichment write routing', () => {
  const testBrandName = '[TEST-ENRICH-ROUTE] Brand'
  let testBrandId: string | null = null

  afterEach(async () => {
    if (testBrandId) {
      await supabase!.from('brands').delete().eq('id', testBrandId)
    }
  })

  it('writes enrichment directly to brands table for hidden brands', async () => {
    const { data: brand } = await supabase!
      .from('brands')
      .insert({ name: testBrandName, slug: 'test-enrich-route', status: 'hidden' })
      .select('id')
      .single()
    const brandId = brand!.id
    testBrandId = brandId

    const { persistEnrichmentResults } = await import('../curation-operations')
    await persistEnrichmentResults(supabase!, brandId, {
      description: 'Enriched description',
      hero_image_url: 'https://example.com/hero.jpg',
      product_type: 'crafts',
    })

    const { data: updatedBrand } = await supabase!
      .from('brands')
      .select('description, hero_image_url, product_type')
      .eq('id', brandId)
      .single()
    expect(updatedBrand!.description).toBe('Enriched description')
    expect(updatedBrand!.hero_image_url).toBe('https://example.com/hero.jpg')
    expect(updatedBrand!.product_type).toBe('crafts')
  })

  it('writes enrichment directly to brands table for approved brands', async () => {
    const { data: brand } = await supabase!
      .from('brands')
      .insert({ name: testBrandName, slug: 'test-enrich-route-approved', status: 'approved' })
      .select('id')
      .single()
    const brandId = brand!.id
    testBrandId = brandId

    const { persistEnrichmentResults } = await import('../curation-operations')
    await persistEnrichmentResults(supabase!, brandId, {
      description: 'Updated description',
    })

    const { data: updatedBrand } = await supabase!
      .from('brands')
      .select('description')
      .eq('id', brandId)
      .single()
    expect(updatedBrand!.description).toBe('Updated description')
  })
})

describeWithDb('persistSubmissionEnrichmentResults', () => {
  let testSubmissionId: string | null = null

  beforeEach(async () => {
    const { data: submission, error } = await serviceSupabase!
      .from('brand_submissions')
      .insert({
        brand_name: '[TEST] Persist Enrich',
        submitter_email: 'persist-enrich@example.com',
        website_url: 'https://test-persist.example.com',
        social_instagram: 'https://instagram.com/testpersist',
        status: 'pending',
        brand_id: null,
      })
      .select('id')
      .single()

    if (error) {
      throw error
    }

    testSubmissionId = submission!.id
  })

  afterEach(async () => {
    if (testSubmissionId) {
      await serviceSupabase!.from('brand_submissions').delete().eq('id', testSubmissionId)
      testSubmissionId = null
    }
  })

  it('should write patch to null enriched_data', async () => {
    await persistSubmissionEnrichmentResults(serviceSupabase!, testSubmissionId!, {
      description: 'Test brand description',
      product_type: 'bags',
    })

    const { data: updated } = await serviceSupabase!
      .from('brand_submissions')
      .select('enriched_data')
      .eq('id', testSubmissionId!)
      .single()

    expect(updated!.enriched_data).toEqual({
      description: 'Test brand description',
      product_type: 'bags',
    })
  })

  it('should deep-merge with existing enriched_data', async () => {
    await serviceSupabase!
      .from('brand_submissions')
      .update({
        enriched_data: {
          description: 'Old desc',
          product_type: 'bags',
        },
      })
      .eq('id', testSubmissionId!)

    await persistSubmissionEnrichmentResults(serviceSupabase!, testSubmissionId!, {
      description: 'New desc',
      hero_image_url: 'https://img.example.com/hero.jpg',
    })

    const { data: updated } = await serviceSupabase!
      .from('brand_submissions')
      .select('enriched_data')
      .eq('id', testSubmissionId!)
      .single()

    expect(updated!.enriched_data).toEqual({
      description: 'New desc',
      product_type: 'bags',
      hero_image_url: 'https://img.example.com/hero.jpg',
    })
  })

  it('should skip update when submission is no longer pending', async () => {
    await serviceSupabase!
      .from('brand_submissions')
      .update({ status: 'approved' })
      .eq('id', testSubmissionId!)

    await persistSubmissionEnrichmentResults(serviceSupabase!, testSubmissionId!, {
      description: 'Skipped description',
    })

    const { data: updated } = await serviceSupabase!
      .from('brand_submissions')
      .select('enriched_data')
      .eq('id', testSubmissionId!)
      .single()

    expect(updated!.enriched_data).toBeNull()
  })
})
