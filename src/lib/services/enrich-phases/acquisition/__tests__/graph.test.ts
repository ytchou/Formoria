import { describe, expect, it, vi } from 'vitest'
import type { AcquisitionDeps, AcquisitionInput } from '../graph'

// Mock external dependencies — only non-service modules (test-boundaries forbids @/lib/services/ mocks)
const mocks = vi.hoisted(() => ({
  auditedCall: vi.fn().mockImplementation((_spec: unknown, fn: (ctx: { summary: Record<string, unknown> }) => unknown) => fn({ summary: {} })),
  fetchLangfusePrompt: vi.fn().mockImplementation((_name: string, fallback: string) => Promise.resolve(fallback)),
  resolveProfileModel: vi.fn().mockReturnValue('gpt-test'),
}))

vi.mock('@/lib/audit', () => ({
  auditedCall: mocks.auditedCall,
}))

vi.mock('@/lib/langfuse/prompt', () => ({
  fetchLangfusePrompt: mocks.fetchLangfusePrompt,
}))

vi.mock('@/lib/constants/llm-models', () => ({
  resolveProfileModel: mocks.resolveProfileModel,
  LLM_PROFILES: { acquisition: { model: 'text', temperature: 0.1, reasoningEffort: 'none', timeoutMs: 30_000 } },
}))

import { runAcquisition } from '../graph'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import { RunnableLambda } from '@langchain/core/runnables'

/**
 * Creates a fake model that returns a sequence of responses.
 * For structured output, wraps responses in AIMessage. For plan node,
 * the model must produce JSON matching AcquisitionPlan. For critique,
 * it must produce a verdict.
 */
function fakeModel(responses: Array<Record<string, unknown>>) {
  let callIdx = 0
  return new RunnableLambda({
    func: async (_input: BaseMessage[]) => {
      const resp = responses[callIdx] ?? responses[responses.length - 1]
      callIdx++
      return new AIMessage({
        content: JSON.stringify(resp),
        usage_metadata: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
      })
    },
  })
}

function makeDeps(overrides: Partial<AcquisitionDeps> = {}): AcquisitionDeps {
  return {
    fetchHtml: vi.fn().mockResolvedValue({ text: '<html><body>Brand content here with enough text</body></html>', status: 200, latencyMs: 50, error: null }),
    renderProvider: {
      fetchRendered: vi.fn().mockResolvedValue({ html: '<html><body>Rendered</body></html>', finalUrl: 'https://example.com', status: 200 }),
    },
    searchBrand: vi.fn().mockResolvedValue({ urls: ['https://found.example.com'], snippets: ['brand info'] }),
    scrapeBrandUrls: vi.fn().mockResolvedValue({
      data: { name: 'Test Brand', description: 'A test brand' },
      statuses: [{ url: 'https://example.com', ok: true, classification: 'official-site', httpStatus: 200, latencyMs: 100, error: null }],
    }),
    ...overrides,
  }
}

const baseInput: AcquisitionInput = {
  brand: { id: 'brand-1', slug: 'test-brand', name: 'Test Brand' },
  knownUrls: ['https://example.com'],
  jobId: 'job-1',
}

describe('acquisition graph', () => {
  it('graph_scripted_model_produces_plan_execute_critique_finalize', async () => {
    const validPlan = {
      surfaces: [
        { url: 'https://example.com', fetch: 'static', strategy: 'official-site', reason: 'main site' },
      ],
      fanOut: [],
      catalog: { entryUrls: [], priorityProductUrls: [] },
      socialBios: {},
      decisions: [{ step: 'plan', action: 'chose static', reason: 'main site', ms: 10 }],
    }
    const verdict = { verdict: 'sufficient', reason: 'enough data' }

    const model = fakeModel([validPlan, verdict])
    const deps = makeDeps()

    const result = await runAcquisition(baseInput, deps, { model })
    expect(result.agentOutcome).toBe('planned')
    expect(result.plan).toBeDefined()
    expect(result.directives).toBeDefined()
    expect(result.scrapeResult).toBeDefined()
    expect(deps.scrapeBrandUrls).toHaveBeenCalledTimes(1)
  })

  it('graph_thin_verdict_runs_recovery_exactly_once', async () => {
    const validPlan = {
      surfaces: [
        { url: 'https://example.com', fetch: 'static', reason: 'main site' },
      ],
      fanOut: ['https://extra.com'],
      catalog: { entryUrls: [], priorityProductUrls: [] },
      socialBios: {},
      decisions: [{ step: 'plan', action: 'chose static', reason: 'main site', ms: 10 }],
    }
    const thinVerdict = { verdict: 'thin', reason: 'not enough data', recoveryAction: 'fanout' }
    const sufficientVerdict = { verdict: 'sufficient', reason: 'enough after recovery' }

    const model = fakeModel([validPlan, thinVerdict, sufficientVerdict])
    const deps = makeDeps()

    const result = await runAcquisition(baseInput, deps, { model })
    expect(result.agentOutcome).toBe('recovered')
    // scrapeBrandUrls called twice: once for execute, once after recovery
    expect(deps.scrapeBrandUrls).toHaveBeenCalledTimes(2)

    // A second thin does NOT loop — it finalizes
    const model2 = fakeModel([validPlan, thinVerdict, thinVerdict])
    const deps2 = makeDeps()
    const result2 = await runAcquisition(baseInput, deps2, { model: model2 })
    expect(result2.agentOutcome).toBe('recovered')
    expect(deps2.scrapeBrandUrls).toHaveBeenCalledTimes(2)
  })

  it('graph_invalid_plan_retries_once_then_fallback', async () => {
    // Both plan attempts return invalid data (missing required fields)
    const invalidPlan = { notAValidField: true }
    const model = fakeModel([invalidPlan, invalidPlan])
    const deps = makeDeps()

    const result = await runAcquisition(baseInput, deps, { model })
    expect(result.agentOutcome).toBe('fallback')
    expect(deps.scrapeBrandUrls).not.toHaveBeenCalled()
  })

  it('graph_budget_exhausted_before_plan_is_fallback', async () => {
    const deps = makeDeps()
    // Force a budget with 0 turns — plan node cannot run
    const result = await runAcquisition(
      baseInput,
      deps,
      {
        model: fakeModel([]),
        budgetOverride: { probes: 0, renders: 0, search: 0, turns: 0, wallClockMs: 0 },
      },
    )
    expect(result.agentOutcome).toBe('fallback')
  })

  it('budget_allowance_and_usage_are_recorded', async () => {
    const validPlan = {
      surfaces: [
        { url: 'https://example.com', fetch: 'static', reason: 'main site' },
      ],
      fanOut: [],
      catalog: { entryUrls: [], priorityProductUrls: [] },
      socialBios: {},
      decisions: [{ step: 'plan', action: 'chose static', reason: 'main site', ms: 10 }],
    }
    const verdict = { verdict: 'sufficient', reason: 'enough' }
    const model = fakeModel([validPlan, verdict])
    const deps = makeDeps()

    const result = await runAcquisition(baseInput, deps, { model })
    expect(result.budget).toBeDefined()
    expect(result.budget).toHaveProperty('allowed')
    expect(result.budget).toHaveProperty('used')
    expect(result.budget!.allowed.probes).toBeGreaterThanOrEqual(0)
    expect(result.budget!.used.probes).toBeGreaterThanOrEqual(0)
  })
})

// ---------------------------------------------------------------------------
// CritiqueVerdict schema tests
// ---------------------------------------------------------------------------

describe('CritiqueVerdict schema', () => {
  it('critique_includes_ownership_verdicts', async () => {
    const { CritiqueVerdictSchema } = await import('../../acquisition/plan')
    const verdictWithOwnership = {
      verdict: 'sufficient',
      reason: 'all URLs verified',
      urlVerdicts: [
        { url: 'https://example.com', owned: true, confidence: 'high', reason: 'domain matches brand name' },
        { url: 'https://other.com', owned: false, confidence: 'medium', reason: 'no brand signals' },
      ],
    }
    const result = CritiqueVerdictSchema.safeParse(verdictWithOwnership)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.urlVerdicts).toHaveLength(2)
      expect(result.data.urlVerdicts![0]).toMatchObject({ url: 'https://example.com', owned: true, confidence: 'high' })
    }
  })
})

// ---------------------------------------------------------------------------
// Images node tests
// ---------------------------------------------------------------------------

describe('acquisition graph — images node', () => {
  const validPlan = {
    surfaces: [
      { url: 'https://example.com', fetch: 'static', strategy: 'official-site', reason: 'main site' },
    ],
    fanOut: [],
    catalog: { entryUrls: [], priorityProductUrls: [] },
    socialBios: {},
    decisions: [],
  }
  const verdict = { verdict: 'sufficient', reason: 'enough data' }

  it('images_node_classifies_scraped_images', async () => {
    const deps = makeDeps({
      scrapeBrandUrls: vi.fn().mockResolvedValue({
        data: {
          name: 'Test Brand',
          description: 'A test brand',
          galleryImageUrls: ['https://cdn.example.com/img1.jpg', 'https://cdn.example.com/img2.jpg'],
          imageSources: [
            { url: 'https://cdn.example.com/img1.jpg', method: 'crawl', pageUrl: 'https://example.com', position: 0 },
            { url: 'https://cdn.example.com/img2.jpg', method: 'crawl', pageUrl: 'https://example.com', position: 1 },
          ],
          jsonLdImageUrls: [],
        },
        statuses: [{ url: 'https://example.com', ok: true, classification: 'official-site', httpStatus: 200, latencyMs: 100, error: null }],
      }),
      downloadAndStoreImages: vi.fn().mockResolvedValue([
        'https://storage.example.com/img1.jpg',
        'https://storage.example.com/img2.jpg',
      ]),
      classifyImages: vi.fn().mockResolvedValue([
        { id: 'img-1', tag: 'product', score: 0.9, storage_path: 'brands/brand-1/img1.jpg' },
        { id: 'img-2', tag: 'hero', score: 0.85, storage_path: 'brands/brand-1/img2.jpg' },
      ]),
    })

    const model = fakeModel([validPlan, verdict])
    const result = await runAcquisition(baseInput, deps, { model })

    expect(result.agentOutcome).toBe('planned')
    expect(result.classifiedImages).toBeDefined()
    expect(result.classifiedImages).toHaveLength(2)
    expect(deps.downloadAndStoreImages).toHaveBeenCalledTimes(1)
    expect(deps.classifyImages).toHaveBeenCalledTimes(1)
  })

  it('images_node_skips_when_dry_run', async () => {
    const deps = makeDeps({
      scrapeBrandUrls: vi.fn().mockResolvedValue({
        data: {
          name: 'Test Brand',
          description: 'desc',
          galleryImageUrls: ['https://cdn.example.com/img1.jpg'],
          imageSources: [],
          jsonLdImageUrls: [],
        },
        statuses: [{ url: 'https://example.com', ok: true, classification: 'official-site', httpStatus: 200, latencyMs: 100, error: null }],
      }),
      downloadAndStoreImages: vi.fn().mockResolvedValue([]),
      classifyImages: vi.fn().mockResolvedValue([]),
    })

    const model = fakeModel([validPlan, verdict])
    const result = await runAcquisition(baseInput, deps, { model, dryRun: true })

    expect(result.agentOutcome).toBe('planned')
    // classify should not be called in dry-run mode
    expect(deps.classifyImages).not.toHaveBeenCalled()
  })

  it('images_node_empty_when_no_images', async () => {
    const deps = makeDeps({
      scrapeBrandUrls: vi.fn().mockResolvedValue({
        data: {
          name: 'Test Brand',
          description: 'desc',
          galleryImageUrls: [],
          imageSources: [],
          jsonLdImageUrls: [],
        },
        statuses: [{ url: 'https://example.com', ok: true, classification: 'official-site', httpStatus: 200, latencyMs: 100, error: null }],
      }),
      downloadAndStoreImages: vi.fn(),
      classifyImages: vi.fn(),
    })

    const model = fakeModel([validPlan, verdict])
    const result = await runAcquisition(baseInput, deps, { model })

    expect(result.classifiedImages).toEqual([])
    // download and classify should NOT be called when no candidates exist
    expect(deps.downloadAndStoreImages).not.toHaveBeenCalled()
    expect(deps.classifyImages).not.toHaveBeenCalled()
  })

  it('finalize_ranks_images', async () => {
    const deps = makeDeps({
      scrapeBrandUrls: vi.fn().mockResolvedValue({
        data: {
          name: 'Test Brand',
          description: 'A test brand',
          galleryImageUrls: ['https://cdn.example.com/img1.jpg', 'https://cdn.example.com/img2.jpg'],
          imageSources: [],
          jsonLdImageUrls: [],
        },
        statuses: [{ url: 'https://example.com', ok: true, classification: 'official-site', httpStatus: 200, latencyMs: 100, error: null }],
      }),
      downloadAndStoreImages: vi.fn().mockResolvedValue([
        'https://storage.example.com/img1.jpg',
        'https://storage.example.com/img2.jpg',
      ]),
      classifyImages: vi.fn().mockResolvedValue([
        { id: 'img-1', tag: 'product', score: 0.7, storage_path: 'brands/brand-1/img1.jpg', width: 800, height: 600 },
        { id: 'img-2', tag: 'hero', score: 0.95, storage_path: 'brands/brand-1/img2.jpg', width: 1200, height: 900 },
      ]),
    })

    const model = fakeModel([validPlan, verdict])
    const result = await runAcquisition(baseInput, deps, { model })

    expect(result.agentOutcome).toBe('planned')
    // imagePool should be populated with ranked images (hero first)
    expect(result.imagePool).toBeDefined()
    expect(result.imagePool!.length).toBeGreaterThan(0)
    // Highest score image should be first (hero)
    expect(result.imagePool![0]!.score).toBeGreaterThanOrEqual(result.imagePool![1]?.score ?? 0)
  })

  it('finalize_writes_image_pool_to_phase_result', async () => {
    const deps = makeDeps({
      scrapeBrandUrls: vi.fn().mockResolvedValue({
        data: {
          name: 'Test Brand',
          description: 'A test brand',
          galleryImageUrls: ['https://cdn.example.com/img1.jpg'],
          imageSources: [
            { url: 'https://cdn.example.com/img1.jpg', method: 'crawl', pageUrl: 'https://example.com', position: 0 },
          ],
          jsonLdImageUrls: [],
        },
        statuses: [{ url: 'https://example.com', ok: true, classification: 'official-site', httpStatus: 200, latencyMs: 100, error: null }],
      }),
      downloadAndStoreImages: vi.fn().mockResolvedValue(['https://storage.example.com/img1.jpg']),
      classifyImages: vi.fn().mockResolvedValue([
        { id: 'img-1', tag: 'product', score: 0.9, storage_path: 'brands/brand-1/img1.jpg', width: 800, height: 600 },
      ]),
    })

    const model = fakeModel([validPlan, verdict])
    const result = await runAcquisition(baseInput, deps, { model })

    expect(result.imagePool).toBeDefined()
    expect(result.imagePool).toHaveLength(1)
    expect(result.imagePool![0]).toMatchObject({
      url: expect.any(String),
      score: expect.any(Number),
      tags: expect.any(Array),
    })
  })

  it('finalize_discovers_catalog', async () => {
    const planWithCatalog = {
      ...validPlan,
      catalog: {
        entryUrls: ['https://example.com/products'],
        priorityProductUrls: ['https://example.com/products/item-1'],
      },
    }
    const fakeCatalogResult = { triples: [], attempts: [], evidence: new Map() }
    const deps = makeDeps({
      scrapeBrandUrls: vi.fn().mockResolvedValue({
        data: {
          name: 'Test Brand',
          description: 'A test brand',
          galleryImageUrls: [],
          imageSources: [],
          jsonLdImageUrls: [],
        },
        statuses: [{ url: 'https://example.com', ok: true, classification: 'official-site', httpStatus: 200, latencyMs: 100, error: null }],
      }),
      discoverCatalog: vi.fn().mockResolvedValue(fakeCatalogResult),
    })

    const model = fakeModel([planWithCatalog, verdict])
    const result = await runAcquisition(baseInput, deps, { model })

    // catalogResult should be present when catalog URLs are available
    expect(result.catalogResult).toBeDefined()
    expect(deps.discoverCatalog).toHaveBeenCalledTimes(1)
  })

  it('images_recover_merges_new_batch', async () => {
    const thinVerdict = { verdict: 'thin', reason: 'need more', recoveryAction: 'fanout' }

    const planWithFanOut = {
      ...validPlan,
      fanOut: ['https://extra.com'],
    }

    let scrapeCallCount = 0
    const deps = makeDeps({
      scrapeBrandUrls: vi.fn().mockImplementation(async () => {
        scrapeCallCount++
        if (scrapeCallCount === 1) {
          return {
            data: {
              name: 'Test Brand',
              description: 'A test brand',
              galleryImageUrls: ['https://cdn.example.com/img1.jpg'],
              imageSources: [],
              jsonLdImageUrls: [],
            },
            statuses: [{ url: 'https://example.com', ok: true, classification: 'official-site', httpStatus: 200, latencyMs: 100, error: null }],
          }
        }
        // Recovery scrape returns additional images
        return {
          data: {
            name: 'Test Brand',
            galleryImageUrls: ['https://cdn.example.com/img-recovery.jpg'],
            imageSources: [],
            jsonLdImageUrls: [],
          },
          statuses: [{ url: 'https://extra.com', ok: true, classification: 'official-site', httpStatus: 200, latencyMs: 100, error: null }],
        }
      }),
      downloadAndStoreImages: vi.fn().mockResolvedValue(['https://storage.example.com/stored.jpg']),
      classifyImages: vi.fn()
        .mockResolvedValueOnce([
          { id: 'img-1', tag: 'product', score: 0.9 },
        ])
        .mockResolvedValueOnce([
          { id: 'img-recovery', tag: 'hero', score: 0.8 },
        ]),
    })

    const model = fakeModel([planWithFanOut, thinVerdict, verdict])
    const result = await runAcquisition(baseInput, deps, { model })

    expect(result.agentOutcome).toBe('recovered')
    // Both initial + recovery images should be merged
    expect(result.classifiedImages).toHaveLength(2)
    expect(deps.downloadAndStoreImages).toHaveBeenCalledTimes(2)
    expect(deps.classifyImages).toHaveBeenCalledTimes(2)
  })
})
