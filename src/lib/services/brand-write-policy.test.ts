import { describe, it, expect } from 'vitest'
import { resolveWritablePatch } from './brand-write-policy'

const state = (over: Record<string, { source: string; adminLocked?: boolean }>) => over

describe('resolveWritablePatch', () => {
  it('enrichment writes empty or enriched-sourced fields only', () => {
    const { allowed, skipped } = resolveWritablePatch(
      { description: '新的描述', city: '台北' },
      state({ description: { source: 'owner' } }),
      { source: 'enriched' },
    )
    expect(allowed).toEqual({ city: '台北' })
    expect(skipped).toEqual([{ field: 'description', reason: 'protected:owner' }])
  })

  it('enrichment can never write mit_story even when empty', () => {
    const { allowed, skipped } = resolveWritablePatch({ mitStory: 'x' }, {}, { source: 'enriched' })
    expect(allowed).toEqual({})
    expect(skipped[0]!.reason).toBe('excluded:mit_story')
  })

  it('owner is blocked only by admin_locked; admin writes anything', () => {
    const s = state({ description: { source: 'admin', adminLocked: true } })
    expect(resolveWritablePatch({ description: 'x' }, s, { source: 'owner' }).allowed).toEqual({})
    expect(resolveWritablePatch({ description: 'x' }, s, { source: 'admin' }).allowed).toEqual({ description: 'x' })
  })
})
