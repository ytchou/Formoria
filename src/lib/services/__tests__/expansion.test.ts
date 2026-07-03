import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runExpansionResearch } from '@/lib/services/expansion-research'

describe('runExpansionResearch', () => {
  beforeEach(() => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    vi.restoreAllMocks()
  })

  it('parses valid DeepSeek response into provenance-typed fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                reputation_summary: {
                  text: 'Known for durable products and strong customer reviews.',
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
              }),
            },
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runExpansionResearch({
      name: 'Test Brand',
      description: 'Test description',
      category: 'home',
      serpSnippets: ['Snippet 1'],
      siteContent: 'Site content',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      reputationSummary: {
        text: 'Known for durable products and strong customer reviews.',
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
  })

  it('returns null fields when DeepSeek response has empty data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                reputation_summary: null,
                manufacturing: {
                  factoryLocation: null,
                  productionModel: null,
                  notes: null,
                  sources: [],
                },
                certifications: [],
                policies: null,
              }),
            },
          },
        ],
      }),
    }))

    const result = await runExpansionResearch({
      name: 'Test Brand',
      description: null,
      serpSnippets: ['Snippet 1'],
      siteContent: null,
    })

    expect(result).toEqual({
      reputationSummary: null,
      manufacturing: {
        factoryLocation: null,
        productionModel: null,
        notes: null,
        sources: [],
      },
      certifications: [],
      policies: null,
    })
  })

  it('returns null on API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

    await expect(runExpansionResearch({
      name: 'Test Brand',
      description: null,
      serpSnippets: ['Snippet 1'],
      siteContent: null,
    })).resolves.toBeNull()
  })
})
