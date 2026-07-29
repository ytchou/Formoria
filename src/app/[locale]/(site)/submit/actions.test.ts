import { afterAll, expect, it, vi } from 'vitest'
import { createTestClient, describeWithDb } from '@/test/setup'
import { OWNER_FEATURES_KEY, setAppSetting } from '@/lib/services/app-settings'
import zhMessages from '../../../../../messages/zh-TW.json'
import { submitOwnerQuick } from './actions'

// `getTranslations` needs a request scope that vitest never provides; resolve the
// namespace out of the real zh-TW catalogue so assertions read the shipped copy.
vi.mock('next-intl/server', async () => {
  const messages = (await import('../../../../../messages/zh-TW.json'))
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

async function countOwnerClaimSubmissions(): Promise<number> {
  const supabase = createTestClient()
  const { count, error } = await supabase
    .from('brand_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('intent', 'owner_claim')
  if (error) throw error
  return count ?? 0
}

describeWithDb('submit actions — owner features kill switch', () => {
  afterAll(async () => {
    await setAppSetting(OWNER_FEATURES_KEY, false)
  })

  it('submitOwnerQuick returns its structured error when the flag is off', async () => {
    await setAppSetting(OWNER_FEATURES_KEY, false)

    try {
      const before = await countOwnerClaimSubmissions()

      // Payload is schema-valid on purpose: the refusal must come from the flag
      // guard, not from a validation throw landing in the same catch block.
      const result = await submitOwnerQuick({
        name: 'Owner Features Flag Guard',
        romanizedName: 'Owner Features Flag Guard',
        website: 'https://owner-features-flag-guard.example.com',
        description: 'A schema-valid payload used to exercise the kill switch.',
        pdpaConsent: true,
        marketingEmailOptIn: false,
        turnstileToken: 'flag-guard-token',
        honeypot: '',
      })

      expect(result).toEqual({ error: zhMessages.submit.errors.unexpected })
      expect(await countOwnerClaimSubmissions()).toBe(before)
    } finally {
      await setAppSetting(OWNER_FEATURES_KEY, false)
    }
  })
})
