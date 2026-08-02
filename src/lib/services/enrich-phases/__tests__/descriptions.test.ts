import { describe, expect, it } from 'vitest'
import { resolveClearedFields } from '../descriptions'
import type { DescriptionRewriteResult } from '../../description-rewrite'
import type { EnrichBrand } from '../types'

/**
 * `_cleared_fields` is the difference between "this phase ran and found
 * nothing" and "this phase never ran". Only the first may empty a live field,
 * so each case below pins one half of that distinction.
 *
 * Tested through the pure resolver rather than by driving the whole phase: the
 * phase reads Supabase, and this project forbids mocking it — `pnpm lint` runs
 * `check:test-boundaries`, which fails on a test that mocks
 * `@/lib/supabase/server`. The resolver is where the entire decision lives, so
 * nothing is lost by testing it directly.
 */
const rewrite = (over: Partial<DescriptionRewriteResult> = {}): DescriptionRewriteResult =>
  ({
    description_zh: null,
    description_en: null,
    description: null,
    blurb_zh: null,
    blurb_en: null,
    priceRange: null,
    productTags: [],
    productTagsEn: [],
    city: null,
    foundingYear: null,
    reputationSummary: null,
    faq: null,
    stockists: null,
    mitIndicators: null,
    validationRejections: [],
    ...over,
  }) as DescriptionRewriteResult

const brandWith = (reputation: unknown): EnrichBrand =>
  ({
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'a-brand',
    name: 'A Brand',
    description: '既有的品牌描述',
    reputation_summary: reputation,
  }) as unknown as EnrichBrand

const EXISTING = { text: '過時的媒體評價', sources: [] }

/** Stands in for the phase's write policy: writable, or protected. */
const writable = () => true
const protectedField = () => false

describe('resolveClearedFields', () => {
  it('clears reputation_summary when the phase ran, found none, and the brand has one', () => {
    expect(resolveClearedFields(rewrite(), brandWith(EXISTING), writable)).toEqual([
      'reputation_summary',
    ])
  })

  it('clears nothing when the brand has no reputation to begin with', () => {
    expect(resolveClearedFields(rewrite(), brandWith(null), writable)).toEqual([])
  })

  // The case that makes the whole mechanism safe: a run without the DETAIL step
  // produces no rewrite at all. That is silence, not a verdict, and must never
  // empty a live field.
  it('clears nothing when the phase produced no rewrite', () => {
    expect(resolveClearedFields(null, brandWith(EXISTING), writable)).toEqual([])
  })

  it('clears nothing when the rewrite actually found a reputation', () => {
    const found = rewrite({
      reputationSummary: { text: '新的媒體評價', textEn: null, sources: [] },
    } as Partial<DescriptionRewriteResult>)
    expect(resolveClearedFields(found, brandWith(EXISTING), writable)).toEqual([])
  })

  // Owner- and admin-owned fields are off limits to the pipeline whether it is
  // writing a value or removing one.
  it('clears nothing when the field is protected', () => {
    expect(resolveClearedFields(rewrite(), brandWith(EXISTING), protectedField)).toEqual([])
  })
})
