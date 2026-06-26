import { describe, it, expectTypeOf } from 'vitest'
import type { BrandStatus } from '../brand'

describe('BrandStatus type', () => {
  it('only allows approved and hidden', () => {
    const approved: BrandStatus = 'approved'
    const hidden: BrandStatus = 'hidden'
    expectTypeOf(approved).toMatchTypeOf<BrandStatus>()
    expectTypeOf(hidden).toMatchTypeOf<BrandStatus>()

    // @ts-expect-error — 'pending' should not be assignable to BrandStatus
    const _pending: BrandStatus = 'pending'
    // @ts-expect-error — 'rejected' should not be assignable to BrandStatus
    const _rejected: BrandStatus = 'rejected'
  })
})
