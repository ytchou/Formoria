import { beforeEach, describe, expect, it, vi } from 'vitest'

import { insertExpansionResult } from '@/lib/services/ai-results'
import { runExpansionPhase } from '@/lib/services/enrich-phases/expansion'
import type { EnrichBrand } from '@/lib/services/enrich-phases/types'
import { runExpansionResearch } from '@/lib/services/expansion-research'

vi.mock('@/lib/services/ai-results', () => ({
  insertExpansionResult: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/services/expansion-research', () => ({
  runExpansionResearch: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: null }),
            }),
          }),
        }),
      }),
    }),
  }),
}))


describe('runExpansionPhase', () => {
  const baseBrand = {
    id: 'brand-1',
    slug: 'test-brand',
    name: 'Test Brand',
    description: 'Test description',
    product_type: 'home',
    site_content: null,
  } as EnrichBrand

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
  })

  it('skips when expansion not in phases list', async () => {
    const { phaseResult } = await runExpansionPhase({
      brand: baseBrand,
      phases: ['descriptions'],
      serpSnippets: ['Snippet 1'],
      scrapedData: {},
    })

    expect(phaseResult.status).toBe('skipped')
  })

  it('skips when all target fields are non-null (fill-gaps)', async () => {
    const { phaseResult } = await runExpansionPhase({
      brand: {
        ...baseBrand,
        reputation_summary: { text: 'Summary' },
        manufacturing: { factoryLocation: 'Taiwan' },
        certifications: [{ name: 'ISO 9001' }],
        policies: { returns: '30-day returns' },
      },
      phases: ['expansion'],
      serpSnippets: ['Snippet 1'],
      scrapedData: {},
    })

    expect(phaseResult.status).toBe('skipped')
  })

  it('runs and returns patch with snake_case keys when fields are null', async () => {
    vi.mocked(runExpansionResearch).mockResolvedValue({
      reputationSummary: {
        text: 'Known for durable products.',
        sources: [
          {
            url: 'https://example.com/review',
            title: 'Review',
            retrievedAt: '2026-07-03T00:00:00.000Z',
          },
        ],
        retrievedAt: '2026-07-03T00:00:00.000Z',
      },
      manufacturing: {
        factoryLocation: 'Taiwan',
        productionModel: 'own',
        notes: 'Manufactured in-house.',
        sources: [
          {
            url: 'https://example.com/about',
            title: 'About',
            retrievedAt: '2026-07-03T00:00:00.000Z',
          },
        ],
      },
      certifications: [
        {
          name: 'ISO 9001',
          issuer: 'ISO',
          year: 2024,
          source: {
            url: 'https://example.com/cert',
            title: 'Certification',
            retrievedAt: '2026-07-03T00:00:00.000Z',
          },
        },
      ],
      policies: {
        returns: '30-day returns',
        warranty: '1-year warranty',
        shipsInternational: true,
        sources: [
          {
            url: 'https://example.com/policies',
            title: 'Policies',
            retrievedAt: '2026-07-03T00:00:00.000Z',
          },
        ],
      },
    })

    const { phaseResult, patch } = await runExpansionPhase({
      brand: {
        ...baseBrand,
        reputation_summary: null,
        manufacturing: null,
        certifications: null,
        policies: null,
      },
      phases: ['expansion'],
      serpSnippets: ['Snippet 1'],
      scrapedData: {},
    })

    expect(phaseResult.status).toBe('succeeded')
    expect(patch).toMatchObject({
      reputation_summary: {
        text: 'Known for durable products.',
      },
      manufacturing: {
        factoryLocation: 'Taiwan',
      },
      certifications: [
        {
          name: 'ISO 9001',
        },
      ],
      policies: {
        returns: '30-day returns',
      },
    })
    expect(insertExpansionResult).toHaveBeenCalledTimes(1)
  })
})
