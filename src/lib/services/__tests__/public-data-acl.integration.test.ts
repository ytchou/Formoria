import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, it } from 'vitest'
import { createTestClient, describeWithDb } from '@/test/setup'

describeWithDb('public application-data ACL contract', () => {
  it('denies application data to anonymous and authenticated JWTs while service reads and writes persist', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const service = createTestClient()
    const suffix = randomUUID().replaceAll('-', '')
    const email = `acl-contract-${suffix}@example.com`
    const password = `Acl-contract-${suffix}`
    const names = [
      'Alpha',
      'Bravo',
      'Charlie',
      'Delta',
      'Echo',
      'Foxtrot',
      'Golf',
      'Hotel',
      'India',
      'Juliet',
      'Kilo',
      'Lima',
      'Mike',
      'Zulu',
    ]

    const { data: createdUser, error: createUserError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    expect(createUserError).toBeNull()
    expect(createdUser.user).not.toBeNull()

    const { data: brands, error: insertError } = await service
      .from('brands')
      .insert(
        names.map((name) => ({
          name: `${name} 臺灣權限驗證 ${suffix}`,
          slug: `acl-contract-${name.toLowerCase()}-${suffix}`,
          status: 'approved' as const,
          is_demo: false,
        })),
      )
      .select('id, name')
    expect(insertError).toBeNull()
    expect(brands).toHaveLength(names.length)

    const firstBrand = brands?.at(0)
    expect(firstBrand).toBeDefined()

    try {
      const anonymous = createClient(url, anonKey)
      const authenticated = createClient(url, anonKey)
      const { error: signInError } = await authenticated.auth.signInWithPassword({
        email,
        password,
      })
      expect(signInError).toBeNull()

      for (const client of [anonymous, authenticated]) {
        const tableRead = await client.from('brands').select('id').limit(1)
        const boundedSearch = await client.rpc('search_brand_page', {
          search_query: suffix,
        })
        const flexibleSearch = await client.rpc('search_brands', {
          search_query: suffix,
        })

        expect(tableRead.error).not.toBeNull()
        expect(boundedSearch.error).not.toBeNull()
        expect(flexibleSearch.error).not.toBeNull()
      }

      const firstPage = await service.rpc('search_brand_page', {
        search_query: suffix,
        sort_mode: 'name',
      })
      expect(firstPage.error).toBeNull()
      expect(firstPage.data).toHaveLength(12)
      expect(firstPage.data?.at(0)?.total_count).toBe(names.length)
      expect(firstPage.data?.at(0)?.id).toBe(
        brands?.find((brand) => brand.name.startsWith('Alpha '))?.id,
      )

      const deepPage = await service.rpc('search_brand_page', {
        search_query: suffix,
        page_offset: 12,
        sort_mode: 'name',
      })
      expect(deepPage.error).toBeNull()
      expect(deepPage.data).toHaveLength(2)
      expect(deepPage.data?.at(0)?.total_count).toBe(names.length)

      const renamed = `臺灣權限驗證已更新 ${suffix}`
      const { data: updated, error: updateError } = await service
        .from('brands')
        .update({ name: renamed })
        .eq('id', firstBrand!.id)
        .select('name')
        .single()
      expect(updateError).toBeNull()
      expect(updated?.name).toBe(renamed)
    } finally {
      const brandIds = brands?.map((brand) => brand.id) ?? []
      if (brandIds.length > 0) await service.from('brands').delete().in('id', brandIds)
      if (createdUser.user) await service.auth.admin.deleteUser(createdUser.user.id)
    }
  })
})
