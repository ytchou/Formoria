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
import { getBrands, searchBrands } from '../brands'

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
    const { brands } = await getBrands({ status: 'approved', category: PRODUCT_TYPE_SLUG })
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
      category: PRODUCT_TYPE_SLUG,
      tags: [VALUE_SLUG],
    })
    const slugs = brands.map((b) => b.slug)
    expect(slugs).toContain(TEST_SLUG)
  })

  it('excludes brand when value tag does not match', async () => {
    const { brands } = await getBrands({
      status: 'approved',
      category: PRODUCT_TYPE_SLUG,
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

  it('returns only claimed approved brands for verificationFilter=verified', async () => {
    const { brands } = await getBrands({ status: 'approved', verificationFilter: 'verified' })
    const slugs = brands.map((brand) => brand.slug)

    expect(slugs).toContain(VERIFIED_SLUG)
    expect(slugs).not.toContain(COMMUNITY_SLUG)
    expect(brands.every((brand) => brand.isVerified)).toBe(true)
  })

  it('returns only unclaimed approved brands for verificationFilter=community', async () => {
    const { brands } = await getBrands({ status: 'approved', verificationFilter: 'community' })
    const slugs = brands.map((brand) => brand.slug)

    expect(slugs).toContain(COMMUNITY_SLUG)
    expect(slugs).not.toContain(VERIFIED_SLUG)
    expect(brands.every((brand) => !brand.isVerified)).toBe(true)
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

describeWithDb('searchBrands — ranking order', () => {
  it('ranks an exact 2-char CJK name first', async () => {
    const results = await searchBrands('遮日', 10)

    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.name).toBe('ZALY 遮日')
  })

  it('ranks a name match above a description-only match', async () => {
    // Q='手工皂': 'Natub 台灣製造天然手工皂 品牌專賣館' matches by name (ws_name=0.5, tier 1)
    // while '艾莎妮亞名床 Aisaniea' matches by description only (ws_desc=0.5, tier 2).
    const results = await searchBrands('手工皂', 20)
    const names = results.map((result) => result.name)

    expect(names).toContain('Natub 台灣製造天然手工皂 品牌專賣館')
    expect(names).toContain('艾莎妮亞名床 Aisaniea')
    expect(names.indexOf('Natub 台灣製造天然手工皂 品牌專賣館')).toBeLessThan(
      names.indexOf('艾莎妮亞名床 Aisaniea')
    )
  })

  it('returns a stable, deterministic order across identical searches', async () => {
    const first = (await searchBrands('山芙蓉', 20)).map((result) => result.name)
    const second = (await searchBrands('山芙蓉', 20)).map((result) => result.name)

    expect(first).toEqual(second)
    expect(first).toContain('中富生物科技 (Zhongfu Biotech)')
  })
})
