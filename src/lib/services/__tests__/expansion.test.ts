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
            order: () => ({ limit: () => Promise.resolve({ data: null }) }),
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
    description: 'Test',
    product_type: 'home',
    site_content: null,
  } as EnrichBrand

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
  })

  it('skips when reputation is already populated', async () => {
    const { phaseResult } = await runExpansionPhase({
      brand: { ...baseBrand, reputation_summary: { text: 'Summary' } },
      phases: ['expansion'],
      serpSnippets: ['Snippet'],
      scrapedData: {},
    })
    expect(phaseResult.status).toBe('skipped')
  })

  it('does not skip when reputation is populated but overwrite is true', async () => {
    vi.mocked(runExpansionResearch).mockResolvedValue({
      reputationSummary: { text: 'Updated summary.', sources: [] },
    })
    const { phaseResult } = await runExpansionPhase({
      brand: { ...baseBrand, reputation_summary: { text: 'Old summary' } },
      phases: ['expansion'],
      serpSnippets: ['Snippet'],
      scrapedData: {},
      overwrite: true,
    })
    expect(phaseResult.status).toBe('succeeded')
  })

  it('returns a reputation-only patch', async () => {
    vi.mocked(runExpansionResearch).mockResolvedValue({
      reputationSummary: {
        text: 'Known for durable products.',
        sources: [{ url: 'https://example.com/review' }],
      },
    })
    const { patch } = await runExpansionPhase({
      brand: { ...baseBrand, reputation_summary: null },
      phases: ['expansion'],
      serpSnippets: ['Snippet'],
      scrapedData: {},
    })
    expect(patch).toEqual({
      reputation_summary: {
        text: 'Known for durable products.',
        sources: [{ url: 'https://example.com/review' }],
      },
    })
    expect(insertExpansionResult).toHaveBeenCalledOnce()
  })
})
