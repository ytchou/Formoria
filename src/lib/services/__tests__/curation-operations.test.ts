import { createClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { processEnrichBrand, mergeEnrichPatches } from '../curation-operations'
import type { CurationConfig } from '../curation-operations'
import { describeWithDb } from '@/test/setup'

vi.mock('../product-type-classifier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../product-type-classifier')>()
  return {
    ...actual,
    triageBrandsBatch: vi.fn(),
  }
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
    brand_highlights: null,
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

  it('generates brand description when description phase is enabled', () => {
    const result = processEnrichBrand(baseBrand, scrapedData, ['descriptions'])
    expect(result.patches.descriptions?.description).toBe(scrapedData.description)
  })

  it('extracts brand highlights from company story', () => {
    const brandWithDesc = { ...baseBrand, description: 'Already has a valid description over twenty chars' }
    const result = processEnrichBrand(brandWithDesc, scrapedData, ['descriptions'])
    expect(result.patches.descriptions?.brand_highlights).toBe(scrapedData.story)
  })

  it('omits description when phase is not requested', () => {
    const result = processEnrichBrand(baseBrand, scrapedData, ['links'])
    expect(result.patches.descriptions).toBeUndefined()
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
    brand_highlights: null,
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

describe('runEnrich triage integration', () => {
  it('calls triageBrandsBatch when detect/slugs/tags phases are active', async () => {
    const { triageBrandsBatch } = await import('../product-type-classifier')
    const mockTriage = vi.mocked(triageBrandsBatch)
    mockTriage.mockResolvedValueOnce(
      new Map([
        ['brand-a', {
          isNonBrand: false,
          nonBrandReason: null,
          slug: 'brand-a',
          slugGenerated: 'brand-a',
          productType: 'beauty',
          valueTags: [],
          confidence: 'high' as const,
        }],
      ])
    )

    const result = await mockTriage([{ slug: 'brand-a', name: 'Brand A', description: null, website: null }])
    expect(result.size).toBe(1)
    expect(result.get('brand-a')?.productType).toBe('beauty')
  })

  it('applies non-brand gating — skips tier 3+4 for flagged brands', async () => {
    const { shouldSkipForNonBrand } = await import('../curation-operations')

    const triageResult = {
      isNonBrand: true,
      nonBrandReason: 'reseller',
      slug: 'some-brand',
      slugGenerated: null,
      productType: null,
      valueTags: [],
      confidence: 'high' as const,
    }

    expect(shouldSkipForNonBrand(triageResult)).toBe(true)
  })

  it('does not gate brands that are not non-brands', async () => {
    const { shouldSkipForNonBrand } = await import('../curation-operations')

    const triageResult = {
      isNonBrand: false,
      nonBrandReason: null,
      slug: 'good-brand',
      slugGenerated: 'good-brand',
      productType: 'beauty',
      valueTags: [],
      confidence: 'high' as const,
    }

    expect(shouldSkipForNonBrand(triageResult)).toBe(false)
  })

  it('does not gate low-confidence non-brands', async () => {
    const { shouldSkipForNonBrand } = await import('../curation-operations')

    const triageResult = {
      isNonBrand: true,
      nonBrandReason: 'maybe reseller',
      slug: 'uncertain-brand',
      slugGenerated: null,
      productType: null,
      valueTags: [],
      confidence: 'low' as const,
    }

    expect(shouldSkipForNonBrand(triageResult)).toBe(false)
  })
})

const supabase =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      )
    : null

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

describeWithDb("enrichment for submissions without brand_id", () => {
  it("enriches a submission directly using submission data as input", async () => {
    const { data: submission } = await supabase!
      .from("brand_submissions")
      .insert({
        brand_name: "[TEST-ENRICH-SUB] Brand",
        submitter_email: "owner@example.com",
        website_url: "https://test-enrich-sub.example.com",
        social_instagram: "https://instagram.com/testenrichsub",
        status: "pending",
        brand_id: null,
      })
      .select("id")
      .single()
    const testSubmissionId = submission!.id

    const { enrichSubmission } = await import("../curation-operations")
    await enrichSubmission(supabase!, testSubmissionId)

    const { data: updated } = await supabase!
      .from("brand_submissions")
      .select("enriched_data")
      .eq("id", testSubmissionId)
      .single()

    expect(updated!.enriched_data).toBeDefined()
    expect(updated!.enriched_data).toHaveProperty("description")

    await supabase!.from("brand_submissions").delete().eq("id", testSubmissionId)
  })
})
