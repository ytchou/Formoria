import { describe, expect, it } from 'vitest'
import { brandNameTokens } from '@/lib/services/link-enrichment'
import { SITE_IDENTITY_CASES } from './fixtures/site-identity-cases'

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

  it('uses directional expected outcomes', () => {
    expect(SITE_IDENTITY_CASES.filter(({ kind }) => kind === 'reject').every(({ expected }) => expected === 'revoke')).toBe(true)
    expect(SITE_IDENTITY_CASES.filter(({ kind }) => kind === 'accept').every(({ expected }) => expected === 'keep')).toBe(true)
  })
})
