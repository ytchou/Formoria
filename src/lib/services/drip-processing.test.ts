import { afterAll, beforeEach, expect, it, vi } from 'vitest'
import { describeWithDb } from '@/test/setup'
import { OWNER_FEATURES_KEY, setAppSetting } from './app-settings'
import { evaluateDrips } from './drip-processing'

const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi.fn(async () => ({ success: true })),
}))

vi.mock('@/lib/email/send', () => ({ sendEmail }))

describeWithDb('drip processing — owner features kill switch', () => {
  beforeEach(() => {
    sendEmail.mockClear()
  })

  afterAll(async () => {
    await setAppSetting(OWNER_FEATURES_KEY, false)
  })

  it('evaluateDrips sends nothing when the flag is off', async () => {
    await setAppSetting(OWNER_FEATURES_KEY, false)

    try {
      // Every drip deep-links to /dashboard, which 404s while owner features are
      // off, so the whole run has to short-circuit before any dispatch.
      for (const dripType of ['welcome', 'profile_nudge', 're_engagement']) {
        expect(await evaluateDrips(dripType)).toEqual({
          sent: 0,
          skipped: 0,
          errors: 0,
        })
      }

      expect(sendEmail).not.toHaveBeenCalled()
    } finally {
      await setAppSetting(OWNER_FEATURES_KEY, false)
    }
  })

  it('still rejects an unknown drip type when the flag is off', async () => {
    await setAppSetting(OWNER_FEATURES_KEY, false)

    await expect(evaluateDrips('not_a_drip')).rejects.toThrow(
      'Unknown drip type: not_a_drip',
    )
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
