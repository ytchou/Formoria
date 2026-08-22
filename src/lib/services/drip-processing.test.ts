import { expect, it } from 'vitest'
import { DRIP_TYPES } from './drip-processing'

// The cron route dispatches exactly DRIP_TYPES, so an entry removed from this
// list is an entry that never sends.
it('keeps the profile_nudge drip paused (DEV-1279)', () => {
  expect(DRIP_TYPES.map((drip) => drip.key)).toEqual([
    'welcome',
    'microsite_spotlight',
    're_engagement',
  ])
})
