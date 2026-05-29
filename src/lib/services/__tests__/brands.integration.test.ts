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
