import { afterAll, expect, it, vi } from 'vitest'

import { createTestClient, describeWithDb } from '@/test/setup'
import {
  isOwnerFeaturesEnabled,
  OWNER_FEATURES_KEY,
  setAppSetting,
} from '@/lib/services/app-settings'
import { getUserBrand } from '@/lib/services/brand-owners'

/**
 * `next/headers` is the framework request boundary, not an internal service or
 * a Supabase module, so faking it stays inside `check-test-boundaries`. Without
 * a request scope `cookies()` throws and the action can never be exercised at
 * all. The Supabase client behind it is real: no session cookies means
 * `getUser()` resolves to an anonymous viewer.
 */
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [] as { name: string; value: string }[],
    set: () => {},
  }),
}))

import { getViewerContextAction } from './viewer-context'

describeWithDb('getViewerContextAction owner features flag', () => {
  afterAll(async () => {
    await setAppSetting(OWNER_FEATURES_KEY, false)
  })

  it('viewer context carries ownerFeaturesEnabled mirroring the flag', async () => {
    try {
      await setAppSetting(OWNER_FEATURES_KEY, true)
      expect((await getViewerContextAction()).ownerFeaturesEnabled).toBe(true)

      await setAppSetting(OWNER_FEATURES_KEY, false)
      expect((await getViewerContextAction()).ownerFeaturesEnabled).toBe(false)
    } finally {
      await setAppSetting(OWNER_FEATURES_KEY, false)
    }
  })

  it('getUserBrand resolves flag-independently', async ({ skip }) => {
    // The claim CTA hides when `hasOwnedBrand` is true, so a flag that leaked
    // into this field would REVEAL the surface it is meant to hide. Ownership
    // must stay derived from brand_owners alone, whatever the flag says.
    //
    // Scope: this covers the SOURCE of that field only — `getUserBrand` takes a
    // user id and has no access to the flag. Asserting the assembled
    // `ViewerContext.hasOwnedBrand` polarity needs an authenticated session and
    // is owned by the deferred e2e spec.
    const supabase = createTestClient()
    const { data: ownerRow } = await supabase
      .from('brand_owners')
      .select('user_id')
      .limit(1)
      .maybeSingle()

    const ownerUserId = (ownerRow as { user_id: string } | null)?.user_id
    if (!ownerUserId) {
      skip('no brand_owners row in the test database to derive an owner from')
      return
    }

    try {
      await setAppSetting(OWNER_FEATURES_KEY, false)
      expect(await isOwnerFeaturesEnabled()).toBe(false)
      expect(await getUserBrand(ownerUserId)).not.toBeNull()

      await setAppSetting(OWNER_FEATURES_KEY, true)
      expect(await getUserBrand(ownerUserId)).not.toBeNull()
    } finally {
      await setAppSetting(OWNER_FEATURES_KEY, false)
    }
  })

  it('anonymous viewers never gain ownership from the flag', async () => {
    try {
      await setAppSetting(OWNER_FEATURES_KEY, true)
      const enabled = await getViewerContextAction()

      await setAppSetting(OWNER_FEATURES_KEY, false)
      const disabled = await getViewerContextAction()

      expect(enabled.hasOwnedBrand).toBe(false)
      expect(disabled.hasOwnedBrand).toBe(false)
      expect(enabled.ownerFeaturesEnabled).toBe(true)
      expect(disabled.ownerFeaturesEnabled).toBe(false)
    } finally {
      await setAppSetting(OWNER_FEATURES_KEY, false)
    }
  })
})
