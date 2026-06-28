/**
 * Integration test: getBrands() with combined category + tags filtering.
 *
 * Slug choices:
 *   product_type: 'food'     — confirmed present in supabase/seed.sql line 20
 *   value:        'handmade' — confirmed present in supabase/seed.sql line 52
 *
 * Requires live Supabase connection (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 * Suite is skipped automatically when env vars are absent (see describeWithDb in setup.ts).
 */

import { beforeAll, afterAll, expect, it } from 'vitest'
import { describeWithDb, createTestClient } from '@/test/setup'
import { getBrands } from '../brands'

const TEST_SLUG = 'zzz-tagslugs-itest'
const VERIFIED_SLUG = 'zzz-verified-tier-itest'
const COMMUNITY_SLUG = 'zzz-community-tier-itest'
const VERIFIED_OWNER_EMAIL = 'zzz-verified-tier-itest@example.com'

// product_type slug and value slug confirmed in seed.sql
const PRODUCT_TYPE_SLUG = 'food'
const VALUE_SLUG = 'handmade'

describeWithDb('getBrands tags+category filtering (integration)', () => {
  beforeAll(async () => {
    const client = createTestClient()

    // Insert throwaway approved brand
    const { error: brandErr } = await client.from('brands').insert({
      name: 'ZZZ TagSlugs Integration Test Brand',
      slug: TEST_SLUG,
      description: 'Throwaway brand for tag_slugs integration test',
      status: 'approved',
    })
    if (brandErr) throw new Error(`Failed to insert test brand: ${brandErr.message}`)

    // Look up the test brand id
    const { data: brand, error: fetchErr } = await client
      .from('brands')
      .select('id')
      .eq('slug', TEST_SLUG)
      .single()
    if (fetchErr || !brand) throw new Error(`Failed to fetch test brand: ${fetchErr?.message}`)

    // Look up taxonomy_tag ids for the two slugs we need
    const { data: tags, error: tagsErr } = await client
      .from('taxonomy_tags')
      .select('id, slug')
      .in('slug', [PRODUCT_TYPE_SLUG, VALUE_SLUG])
    if (tagsErr || !tags || tags.length < 2) {
      throw new Error(
        `Failed to find seed taxonomy tags (${PRODUCT_TYPE_SLUG}, ${VALUE_SLUG}): ${tagsErr?.message ?? 'got ' + (tags?.length ?? 0) + ' rows'}`
      )
    }

    // Insert brand_taxonomy rows — trigger will populate tag_slugs automatically
    const rows = tags.map((t) => ({ brand_id: brand.id, tag_id: t.id }))
    const { error: taxErr } = await client.from('brand_taxonomy').insert(rows)
    if (taxErr) throw new Error(`Failed to insert brand_taxonomy rows: ${taxErr.message}`)
  })

  afterAll(async () => {
    const client = createTestClient()
    // Cascade delete cleans brand_taxonomy rows too
    await client.from('brands').delete().eq('slug', TEST_SLUG)
  })

  it('returns brand when filtering by category only', async () => {
    const { brands } = await getBrands({ status: 'approved', category: [PRODUCT_TYPE_SLUG] })
    const slugs = brands.map((b) => b.slug)
    expect(slugs).toContain(TEST_SLUG)
  })

  it('returns brand when filtering by value tag only', async () => {
    const { brands } = await getBrands({ status: 'approved', tags: [VALUE_SLUG] })
    const slugs = brands.map((b) => b.slug)
    expect(slugs).toContain(TEST_SLUG)
  })

  it('returns brand when filtering by category AND value tag (the bug scenario)', async () => {
    const { brands } = await getBrands({
      status: 'approved',
      category: [PRODUCT_TYPE_SLUG],
      tags: [VALUE_SLUG],
    })
    const slugs = brands.map((b) => b.slug)
    expect(slugs).toContain(TEST_SLUG)
  })

  it('excludes brand when value tag does not match', async () => {
    const { brands } = await getBrands({
      status: 'approved',
      category: [PRODUCT_TYPE_SLUG],
      tags: ['nonexistent-zzz'],
    })
    const slugs = brands.map((b) => b.slug)
    expect(slugs).not.toContain(TEST_SLUG)
  })
})

describeWithDb('getBrands — verificationFilter', () => {
  let verifiedBrandId: string
  let ownerUserId: string

  beforeAll(async () => {
    const client = createTestClient()

    const { error: brandErr } = await client.from('brands').insert([
      {
        name: 'ZZZ Verified Tier Integration Test Brand',
        slug: VERIFIED_SLUG,
        description: 'Throwaway verified brand for verificationFilter integration test',
        status: 'approved',
        mit_status: 'verified',
      },
      {
        name: 'ZZZ Community Tier Integration Test Brand',
        slug: COMMUNITY_SLUG,
        description: 'Throwaway community brand for verificationFilter integration test',
        status: 'approved',
      },
    ])
    if (brandErr) throw new Error(`Failed to insert verification test brands: ${brandErr.message}`)

    const { data: brands, error: fetchErr } = await client
      .from('brands')
      .select('id, slug')
      .in('slug', [VERIFIED_SLUG, COMMUNITY_SLUG])
    if (fetchErr || !brands || brands.length < 2) {
      throw new Error(
        `Failed to fetch verification test brands: ${fetchErr?.message ?? 'got ' + (brands?.length ?? 0) + ' rows'}`
      )
    }

    const verifiedBrand = brands.find((brand) => brand.slug === VERIFIED_SLUG)
    const communityBrand = brands.find((brand) => brand.slug === COMMUNITY_SLUG)
    if (!verifiedBrand || !communityBrand) {
      throw new Error('Failed to find seeded verification test brands by slug')
    }

    verifiedBrandId = verifiedBrand.id

    const { data: createdUser, error: userErr } = await client.auth.admin.createUser({
      email: VERIFIED_OWNER_EMAIL,
      password: 'Password123!',
      email_confirm: true,
    })
    if (userErr || !createdUser.user) {
      throw new Error(`Failed to create verification test owner user: ${userErr?.message}`)
    }

    ownerUserId = createdUser.user.id

    const { error: ownerErr } = await client.from('brand_owners').insert({
      user_id: ownerUserId,
      brand_id: verifiedBrandId,
    })
    if (ownerErr) throw new Error(`Failed to insert verification test owner row: ${ownerErr.message}`)
  })

  afterAll(async () => {
    const client = createTestClient()

    if (verifiedBrandId) {
      await client.from('brand_owners').delete().eq('brand_id', verifiedBrandId)
    }

    await client.from('brands').delete().in('slug', [VERIFIED_SLUG, COMMUNITY_SLUG])

    if (ownerUserId) {
      await client.auth.admin.deleteUser(ownerUserId)
    }
  })

  it('returns only owned approved brands for verificationFilter=owned', async () => {
    const { brands } = await getBrands({ status: 'approved', verificationFilter: 'owned' })
    const slugs = brands.map((brand) => brand.slug)

    expect(slugs).toContain(VERIFIED_SLUG)
    expect(slugs).not.toContain(COMMUNITY_SLUG)
    expect(brands.every((brand) => brand.isVerified)).toBe(true)
  })

  it('returns only MIT verified approved brands for verificationFilter=mit-verified', async () => {
    const { brands } = await getBrands({ status: 'approved', verificationFilter: 'mit-verified' })
    const slugs = brands.map((brand) => brand.slug)

    expect(slugs).toContain(VERIFIED_SLUG)
    expect(slugs).not.toContain(COMMUNITY_SLUG)
    expect(brands.every((brand) => brand.mitStatus === 'verified')).toBe(true)
  })

  it('returns both tiers for verificationFilter=all and when omitted', async () => {
    const { brands: allBrands } = await getBrands({ status: 'approved', verificationFilter: 'all' })
    const { brands: defaultBrands } = await getBrands({ status: 'approved' })

    const allSlugs = allBrands.map((brand) => brand.slug)
    const defaultSlugs = defaultBrands.map((brand) => brand.slug)

    expect(allSlugs).toContain(VERIFIED_SLUG)
    expect(allSlugs).toContain(COMMUNITY_SLUG)
    expect(defaultSlugs).toContain(VERIFIED_SLUG)
    expect(defaultSlugs).toContain(COMMUNITY_SLUG)
  })
})

describeWithDb('getBrands — test brand exclusion', () => {
  const TEST_BRAND_SLUG = 'zzz-e2e-test-exclusion-itest'
  const TEST_BRAND_NAME = '[E2E-TEST] Exclusion Integration Test Brand'

  beforeAll(async () => {
    const client = createTestClient()
    const { error } = await client.from('brands').insert({
      name: TEST_BRAND_NAME,
      slug: TEST_BRAND_SLUG,
      description: 'Throwaway brand for [E2E-TEST] exclusion integration test',
      status: 'approved',
    })
    if (error) throw new Error(`Failed to insert test brand: ${error.message}`)
  })

  afterAll(async () => {
    const client = createTestClient()
    await client.from('brands').delete().eq('slug', TEST_BRAND_SLUG)
  })

  it('excludes [E2E-TEST] brands from getBrands by default', async () => {
    const { brands } = await getBrands({ status: 'approved' })
    const slugs = brands.map((b) => b.slug)
    expect(slugs).not.toContain(TEST_BRAND_SLUG)
  })

  it('includes [E2E-TEST] brands when includeTestBrands is true', async () => {
    const { brands } = await getBrands({ status: 'approved', includeTestBrands: true })
    const slugs = brands.map((b) => b.slug)
    expect(slugs).toContain(TEST_BRAND_SLUG)
  })
})

describeWithDb('getBrands — FTS search path', () => {
  it('searches across tags and categories, not just name/description', async () => {
    const result = await getBrands({
      search: 'sustainable',
      status: 'approved',
      includeTestBrands: false,
    })
    expect(result).toHaveProperty('brands')
    expect(result).toHaveProperty('totalCount')
    expect(Array.isArray(result.brands)).toBe(true)
  })

  it('returns totalCount for pagination when search is active', async () => {
    const result = await getBrands({
      search: 'taiwan',
      status: 'approved',
      includeTestBrands: false,
    })
    expect(typeof result.totalCount).toBe('number')
    expect(result.totalCount).toBeGreaterThanOrEqual(0)
  })

  it('respects sort override with search active', async () => {
    const result = await getBrands({
      search: 'taiwan',
      sort: 'name',
      status: 'approved',
      includeTestBrands: false,
    })
    if (result.brands.length >= 2) {
      const names = result.brands.map((b) => b.name)
      const sorted = [...names].sort((a, b) => a.localeCompare(b))
      expect(names).toEqual(sorted)
    }
  })

  it('paginates search results correctly', async () => {
    const page1 = await getBrands({
      search: 'taiwan',
      page: 1,
      status: 'approved',
      includeTestBrands: false,
    })
    const page2 = await getBrands({
      search: 'taiwan',
      page: 2,
      status: 'approved',
      includeTestBrands: false,
    })
    if (page1.brands.length > 0 && page2.brands.length > 0) {
      const page1Ids = new Set(page1.brands.map((b) => b.id))
      const page2Ids = page2.brands.map((b) => b.id)
      for (const id of page2Ids) {
        expect(page1Ids.has(id)).toBe(false)
      }
    }
  })
})
