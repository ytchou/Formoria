import { afterAll, expect, it, vi } from 'vitest'
import { createTestClient, describeWithDb } from '@/test/setup'
import { OWNER_FEATURES_KEY, setAppSetting } from '@/lib/services/app-settings'
import zhMessages from '../../../../../../messages/zh-TW.json'
import { getPendingClaimStatusAction, submitClaimAction } from './actions'

// The flag guard runs before `requireClaimUser`, so the stub proves the refusal
// comes from the kill switch and not from a missing session.
const { claimUser } = vi.hoisted(() => ({
  claimUser: {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'owner@example.test',
  },
}))

vi.mock('@/lib/auth/claim-user', () => ({
  requireClaimUser: async () => claimUser,
}))

// `getTranslations` needs a request scope that vitest never provides; resolve the
// namespace out of the real zh-TW catalogue so assertions read the shipped copy.
vi.mock('next-intl/server', async () => {
  const messages = (await import('../../../../../../messages/zh-TW.json'))
    .default as unknown as Record<string, unknown>

  return {
    getLocale: async () => 'zh-TW',
    getTranslations: async (namespace: string) => {
      const dictionary = namespace
        .split('.')
        .reduce<Record<string, unknown> | undefined>(
          (node, key) => node?.[key] as Record<string, unknown> | undefined,
          messages,
        )
      return (key: string) => String(dictionary?.[key] ?? key)
    },
  }
})

async function countClaimRequests(): Promise<number> {
  const supabase = createTestClient()
  const { count, error } = await supabase
    .from('claim_requests')
    .select('id', { count: 'exact', head: true })
  if (error) throw error
  return count ?? 0
}

describeWithDb('brand detail actions — owner features kill switch', () => {
  afterAll(async () => {
    await setAppSetting(OWNER_FEATURES_KEY, false)
  })

  it('submitClaimAction returns its structured error when the flag is off', async () => {
    await setAppSetting(OWNER_FEATURES_KEY, false)

    try {
      const supabase = createTestClient()
      const { data: brand } = await supabase
        .from('brands')
        .select('id')
        .limit(1)
        .maybeSingle()
      const before = await countClaimRequests()

      const result = await submitClaimAction({
        brandId: brand?.id ?? '00000000-0000-4000-8000-0000000000ff',
        proofs: [{ type: 'domain_email', url: 'owner@example.test' }],
      })

      expect(result).toEqual({
        error: zhMessages.brandDetail.claim.errors.unknown,
      })
      expect(await countClaimRequests()).toBe(before)
    } finally {
      await setAppSetting(OWNER_FEATURES_KEY, false)
    }
  })

  it('getPendingClaimStatusAction reports no pending claim when the flag is off', async () => {
    await setAppSetting(OWNER_FEATURES_KEY, false)

    try {
      expect(
        await getPendingClaimStatusAction('00000000-0000-4000-8000-0000000000ff'),
      ).toBe(false)
    } finally {
      await setAppSetting(OWNER_FEATURES_KEY, false)
    }
  })
})
