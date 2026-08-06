import { describe, expect, it } from 'vitest'
import { brandNameTokens } from '@/lib/services/link-enrichment'
import { SITE_IDENTITY_CASES, evidenceFor, isUnscoreable } from './fixtures/site-identity-cases'

describe('site identity eval fixtures', () => {
  it('every fixture carries a production-sourced subject url', () => {
    for (const testCase of SITE_IDENTITY_CASES) {
      expect(testCase.provenance).toMatch(/^(brands\.[a-z_]+#.+|incident:.+)$/)
      expect(new URL(testCase.subjectUrl).hostname).not.toBe('')
    }
  })

  it('both subject kinds are represented', () => {
    expect(SITE_IDENTITY_CASES.some(({ subjectKind }) => subjectKind === 'source-page')).toBe(true)
    expect(SITE_IDENTITY_CASES.some(({ subjectKind }) => subjectKind === 'website')).toBe(true)
  })

  it('the Han accept slice is non-empty', () => {
    expect(
      SITE_IDENTITY_CASES.filter(
        ({ brandName, kind }) => kind === 'accept' && brandNameTokens(brandName).length === 0,
      ).length,
    ).toBeGreaterThanOrEqual(5)
  })

  it('has unique ids and non-empty columns', () => {
    expect(new Set(SITE_IDENTITY_CASES.map(({ id }) => id)).size).toBe(SITE_IDENTITY_CASES.length)
    expect(SITE_IDENTITY_CASES.every(({ columns }) => columns.length > 0)).toBe(true)
  })

  // The corpus originally carried no page evidence at all. Production skips a
  // subject whose evidence is empty and the prompt answers `low` when text is
  // insufficient — which releases — so both arms scored their release default
  // and the merge gate could never fire. These four assertions are what stops
  // that from coming back.
  it('every scoreable case carries captured page text', () => {
    for (const testCase of SITE_IDENTITY_CASES) {
      if (isUnscoreable(testCase)) continue
      const evidence = evidenceFor(testCase.id)
      expect(evidence.title || evidence.description || evidence.story).toBeTruthy()
      expect(evidence.capturedFrom).toBeTruthy()
    }
  })

  it('every unscoreable case records why the capture failed', () => {
    for (const testCase of SITE_IDENTITY_CASES) {
      if (!isUnscoreable(testCase)) continue
      expect(evidenceFor(testCase.id).unscoreable).toBeTruthy()
    }
  })

  it('neither arm is entirely unscoreable', () => {
    for (const kind of ['accept', 'reject'] as const) {
      const scoreable = SITE_IDENTITY_CASES.filter(
        (testCase) => testCase.kind === kind && !isUnscoreable(testCase),
      )
      expect(scoreable.length).toBeGreaterThan(0)
    }
  })

  it('the Han accept slice is still scoreable', () => {
    expect(
      SITE_IDENTITY_CASES.filter(
        (testCase) =>
          testCase.kind === 'accept' &&
          brandNameTokens(testCase.brandName).length === 0 &&
          !isUnscoreable(testCase),
      ).length,
    ).toBeGreaterThanOrEqual(5)
  })

  it('uses directional expected outcomes', () => {
    expect(SITE_IDENTITY_CASES.filter(({ kind }) => kind === 'reject').every(({ expected }) => expected === 'revoke')).toBe(true)
    expect(SITE_IDENTITY_CASES.filter(({ kind }) => kind === 'accept').every(({ expected }) => expected === 'keep')).toBe(true)
  })
})
