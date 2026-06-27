import { describe, it, expect } from 'vitest'
import {
  formatPhaseProgress,
  formatBrandComplete,
  formatJobStart,
  formatJobSummary,
  ENRICH_PREFIX,
  SEPARATOR,
  type EnrichmentSummary,
} from '../enrichment-logger'

describe('enrichment-logger', () => {
  it('exports the enrichment log prefix', () => {
    expect(ENRICH_PREFIX).toBe('[ENRICH]')
  })

  describe('formatPhaseProgress', () => {
    it('formats successful phase with brand and phase counters', () => {
      const result = formatPhaseProgress({
        brandSlug: 'some-brand',
        brandIndex: 3,
        totalBrands: 10,
        phaseName: 'discover',
        phaseIndex: 1,
        totalPhases: 6,
        status: 'success',
        durationMs: 1200,
      })
      expect(result).toBe('[ENRICH] [3/10] some-brand — [1/6] discover ✓ (1.2s)')
    })

    it('formats failed phase', () => {
      const result = formatPhaseProgress({
        brandSlug: 'bad-brand',
        brandIndex: 5,
        totalBrands: 10,
        phaseName: 'links',
        phaseIndex: 4,
        totalPhases: 6,
        status: 'failed',
        durationMs: 3000,
      })
      expect(result).toBe('[ENRICH] [5/10] bad-brand — [4/6] links ✗ (3.0s)')
    })

    it('formats skipped phase', () => {
      const result = formatPhaseProgress({
        brandSlug: 'skip-brand',
        brandIndex: 2,
        totalBrands: 5,
        phaseName: 'images',
        phaseIndex: 5,
        totalPhases: 6,
        status: 'skipped',
        durationMs: 100,
      })
      expect(result).toBe('[ENRICH] [2/5] skip-brand — [5/6] images ⊘ (0.1s)')
    })
  })

  describe('formatBrandComplete', () => {
    it('formats brand completion with total duration', () => {
      const result = formatBrandComplete('some-brand', 1, 10, 5900)
      expect(result).toBe('[ENRICH] [1/10] some-brand — complete (5.9s)')
    })
  })

  describe('formatJobStart', () => {
    it('returns start banner lines', () => {
      const lines = formatJobStart(10)
      expect(lines).toHaveLength(3)
      expect(lines[0]).toBe(SEPARATOR)
      expect(lines[1]).toBe('[ENRICH] Starting enrichment for 10 brands')
      expect(lines[2]).toBe(SEPARATOR)
    })
  })

  describe('formatJobSummary', () => {
    it('formats summary with failed brands', () => {
      const summary: EnrichmentSummary = {
        success: 8,
        skipped: 1,
        failed: 1,
        failedBrands: [{ slug: 'brand-xyz', phase: 'discover', error: 'API timeout' }],
        durationMs: 45200,
      }
      const lines = formatJobSummary(summary)
      expect(lines[0]).toBe(SEPARATOR)
      expect(lines).toContainEqual('[ENRICH] Summary: 8 success, 1 skipped, 1 failed')
      expect(lines).toContainEqual('[ENRICH] Failed: brand-xyz (discover: API timeout)')
      expect(lines).toContainEqual('[ENRICH] Duration: 45.2s')
      expect(lines[lines.length - 1]).toBe(SEPARATOR)
    })

    it('formats clean summary without failures', () => {
      const summary: EnrichmentSummary = {
        success: 5,
        skipped: 0,
        failed: 0,
        failedBrands: [],
        durationMs: 10000,
      }
      const lines = formatJobSummary(summary)
      expect(lines).toContainEqual('[ENRICH] Summary: 5 success, 0 skipped, 0 failed')
      expect(lines.some((l) => l.includes('Failed:'))).toBe(false)
      expect(lines).toContainEqual('[ENRICH] Duration: 10.0s')
    })
  })
})
