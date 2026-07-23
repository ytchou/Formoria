import { describe, it, expect } from 'vitest'
import { resolveRefreshEnrichmentPatch, resolveWritablePatch } from './brand-write-policy'

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

  it('owner is blocked by admin_locked; admin writes anything', () => {
    const s = state({ description: { source: 'admin', adminLocked: true } })
    expect(resolveWritablePatch({ description: 'x' }, s, { source: 'owner' }).allowed).toEqual({})
    expect(resolveWritablePatch({ description: 'x' }, s, { source: 'admin' }).allowed).toEqual({ description: 'x' })
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
  it('allows empty and enrichment-owned fields while protecting submitted and identity fields', () => {
    expect(
      resolveRefreshEnrichmentPatch(
        {
          description: 'new description',
          city: '台北',
          product_type: 'fashion',
          name: 'renamed by AI',
        },
        {
          description: 'owner description',
          city: null,
          product_type: 'home',
          name: 'Original identity',
        },
        {
          description: { source: 'submitted' },
          product_type: { source: 'enriched' },
        }
      )
    ).toEqual({
      allowed: { city: '台北', product_type: 'fashion' },
      skipped: [
        { field: 'description', reason: 'protected:submitted' },
        { field: 'name', reason: 'excluded:identity' },
      ],
    })
  })

  it('protects non-empty unclassified and admin-locked base fields', () => {
    expect(
      resolveRefreshEnrichmentPatch(
        { city: '台中', description: 'candidate' },
        { city: '台南', description: null },
        { description: { source: 'enriched', adminLocked: true } }
      )
    ).toEqual({
      allowed: {},
      skipped: [
        { field: 'city', reason: 'protected:unclassified' },
        { field: 'description', reason: 'protected:admin_locked' },
      ],
    })
  })

  it('protects owner provenance even when the snapshotted value is empty', () => {
    expect(
      resolveRefreshEnrichmentPatch(
        { description: 'candidate' },
        { description: null },
        { description: { source: 'owner' } }
      )
    ).toEqual({
      allowed: {},
      skipped: [{ field: 'description', reason: 'protected:owner' }],
    })
  })

  it('preserves owner-confirmed locations without restoring stale unconfirmed rows', () => {
    expect(
      resolveRefreshEnrichmentPatch(
        {
          retail_locations: [
            {
              kind: 'location',
              name: 'Existing shop',
              relationshipType: 'brand_store',
              address: '臺北市新地址 2 號',
              latitude: 25.03,
              longitude: 121.56,
              confirmationStatus: 'unconfirmed',
            },
            {
              kind: 'location',
              name: 'New stockist',
              relationshipType: 'stockist',
              address: '臺中市新增路 3 號',
              confirmationStatus: 'unconfirmed',
            },
          ],
          description: 'AI replacement',
        },
        {
          retail_locations: [
            {
              kind: 'location',
              name: 'Existing shop',
              relationshipType: 'brand_store',
              address: '臺北市人工地址 1 號',
              availabilityNote: 'Keep this note',
              confirmationStatus: 'owner_confirmed',
            },
            {
              kind: 'location',
              name: 'Stale generated location',
              relationshipType: 'stockist',
              confirmationStatus: 'unconfirmed',
            },
          ],
          description: 'Human description',
        },
        {
          retail_locations: { source: 'admin' },
          description: { source: 'admin' },
        },
      ),
    ).toEqual({
      allowed: {
        retail_locations: [
          expect.objectContaining({
            name: 'Existing shop',
            address: '臺北市人工地址 1 號',
            availabilityNote: 'Keep this note',
            confirmationStatus: 'owner_confirmed',
          }),
          expect.objectContaining({
            name: 'New stockist',
            address: '臺中市新增路 3 號',
            confirmationStatus: 'unconfirmed',
          }),
        ],
      },
      skipped: [{ field: 'description', reason: 'protected:admin' }],
    })
  })
})
