import { describe, it, expect } from 'vitest'
import { resolveRefreshEnrichmentPatch, resolveWritablePatch } from './brand-write-policy'

const state = (over: Record<string, { source: string }>) => over

describe('resolveWritablePatch', () => {
  it('enrichment writes everything except owner-sourced fields', () => {
    const { allowed, skipped } = resolveWritablePatch(
      { description: '新的描述', city: '台北' },
      state({ description: { source: 'owner' } }),
      { source: 'enriched' },
    )
    expect(allowed).toEqual({ city: '台北' })
    expect(skipped).toEqual([{ field: 'description', reason: 'protected:owner' }])
  })

  it('enrichment overwrites admin and submitted provenance', () => {
    const { allowed, skipped } = resolveWritablePatch(
      { description: 'x', city: 'y' },
      state({ description: { source: 'admin' }, city: { source: 'submitted' } }),
      { source: 'enriched' },
    )
    expect(allowed).toEqual({ description: 'x', city: 'y' })
    expect(skipped).toEqual([])
  })

  it('enrichment can never write mit_story even when empty', () => {
    const { allowed, skipped } = resolveWritablePatch({ mitStory: 'x' }, {}, { source: 'enriched' })
    expect(allowed).toEqual({})
    expect(skipped[0]!.reason).toBe('excluded:mit_story')
  })

  it('owner and admin both write a previously admin-stamped field', () => {
    const s = state({ description: { source: 'admin' } })
    expect(resolveWritablePatch({ description: 'x' }, s, { source: 'owner' }).allowed).toEqual({
      description: 'x',
    })
    expect(resolveWritablePatch({ description: 'x' }, s, { source: 'admin' }).allowed).toEqual({
      description: 'x',
    })
  })

  it.each(['mit_declared_scope', 'mit_declared_at', 'mit_declared_by'])(
    'strips %s from owner writes',
    (field) => {
      const { allowed } = resolveWritablePatch(
        { name: 'ok', [field]: 'x' },
        {},
        { source: 'owner' },
      )

      expect(allowed).toEqual({ name: 'ok' })
      expect(allowed).not.toHaveProperty(field)
    },
  )
})

describe('resolveRefreshEnrichmentPatch', () => {
  it('protects owner and identity fields, and nothing else', () => {
    expect(
      resolveRefreshEnrichmentPatch(
        {
          description: 'new description',
          city: '台北',
          product_type: 'fashion',
          name: 'renamed by AI',
        },
        {
          description: { source: 'owner' },
          product_type: { source: 'enriched' },
        }
      )
    ).toEqual({
      allowed: { city: '台北', product_type: 'fashion' },
      skipped: [
        { field: 'description', reason: 'protected:owner' },
        { field: 'name', reason: 'excluded:identity' },
      ],
    })
  })

  // The provenance backfill in 20260720140736 stamped 4,150 rows `admin` via an
  // `else` branch, and `submitted` marks fields enrichment failed to fill on an
  // anonymous submission. Neither is evidence a human chose the value.
  it('overwrites admin and submitted provenance', () => {
    expect(
      resolveRefreshEnrichmentPatch(
        { description: 'candidate', city: '台中' },
        { description: { source: 'admin' }, city: { source: 'submitted' } }
      )
    ).toEqual({
      allowed: { description: 'candidate', city: '台中' },
      skipped: [],
    })
  })

  it('overwrites a field with no state row at all', () => {
    expect(resolveRefreshEnrichmentPatch({ city: '台中' }, {})).toEqual({
      allowed: { city: '台中' },
      skipped: [],
    })
  })

  // A clear is a write: an owner-authored field must leave the cleared list
  // rather than be silently emptied.
  it('removes an owner field from _cleared_fields', () => {
    expect(
      resolveRefreshEnrichmentPatch(
        { _cleared_fields: ['reputation_summary', 'city'] },
        {
          reputation_summary: { source: 'owner' },
          city: { source: 'enriched' },
        }
      )
    ).toEqual({
      allowed: { _cleared_fields: ['city'] },
      skipped: [{ field: 'reputation_summary', reason: 'cleared:protected:owner' }],
    })
  })

  it('drops _cleared_fields entirely when every entry is protected', () => {
    const { allowed, skipped } = resolveRefreshEnrichmentPatch(
      { _cleared_fields: ['reputation_summary'] },
      { reputation_summary: { source: 'owner' } }
    )

    expect(allowed).not.toHaveProperty('_cleared_fields')
    expect(skipped).toEqual([{ field: 'reputation_summary', reason: 'cleared:protected:owner' }])
  })

  it('passes an admin-stamped clear through, but not an owner one', () => {
    expect(
      resolveRefreshEnrichmentPatch(
        { city: '台中', _cleared_fields: ['reputation_summary'] },
        { reputation_summary: { source: 'admin' } }
      )
    ).toEqual({
      allowed: { city: '台中', _cleared_fields: ['reputation_summary'] },
      skipped: [],
    })
  })

  it('protects owner provenance regardless of the current value', () => {
    expect(
      resolveRefreshEnrichmentPatch({ description: 'candidate' }, {
        description: { source: 'owner' },
      })
    ).toEqual({
      allowed: {},
      skipped: [{ field: 'description', reason: 'protected:owner' }],
    })
  })
})
