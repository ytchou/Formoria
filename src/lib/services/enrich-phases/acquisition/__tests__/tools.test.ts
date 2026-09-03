import { describe, expect, it, vi } from 'vitest'
import {
  createAcquisitionTools,
  type AcquisitionToolContext,
  type AcquisitionToolDeps,
} from '../tools'
import type { BudgetState } from '../budget'
import type { AcquisitionPlanType } from '../plan'

function makeDeps(overrides: Partial<AcquisitionToolDeps> = {}): AcquisitionToolDeps {
  return {
    fetchHtml: vi.fn().mockResolvedValue({
      text: '<html><head><title>Test</title></head><body>Hello world</body></html>',
      status: 200,
      latencyMs: 100,
      error: null,
    }),
    renderProvider: {
      fetchRendered: vi.fn().mockResolvedValue({
        html: '<html><body>Rendered</body></html>',
        finalUrl: 'https://example.com',
        status: 200,
      }),
    },
    ...overrides,
  }
}

function makeBudget(overrides: Partial<BudgetState['allowed']> = {}): BudgetState {
  return {
    allowed: { probes: 8, renders: 3, search: 1, turns: 6, wallClockMs: 90_000, ...overrides },
    used: { probes: 0, renders: 0, search: 0, turns: 0, wallClockMs: 0 },
  }
}

function makeContext(overrides: Partial<AcquisitionToolContext> = {}): AcquisitionToolContext {
  return {
    allowlist: { knownUrls: new Set(['https://example.com']), discoveredUrls: new Set() },
    budget: makeBudget(),
    ...overrides,
  }
}

/**
 * Tools answer the model with a JSON string; tests read the parsed payload.
 * The invoke signature is narrowed by hand because `StructuredToolInterface`
 * types its input against the tool's own schema generic, which differs per tool.
 */
type InvokableTool = { name: string; invoke: (args: Record<string, unknown>) => Promise<unknown> }

async function callTool(
  tools: ReturnType<typeof createAcquisitionTools>,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const found = (tools as unknown as InvokableTool[]).find((candidate) => candidate.name === name)
  if (!found) throw new Error(`tool not registered: ${name}`)
  const raw = await found.invoke(args)
  return JSON.parse(String(raw)) as Record<string, unknown>
}

const VALID_PLAN = {
  surfaces: [{ url: 'https://example.com', fetch: 'static', reason: 'main site' }],
  fanOut: [],
  catalog: { entryUrls: [], priorityProductUrls: [] },
  socialBios: {},
  decisions: [],
}

describe('acquisition tools', () => {
  it('tool_list_is_the_four_model_callable_tools', () => {
    const tools = createAcquisitionTools(makeDeps(), makeContext())
    expect(tools.map((t) => t.name)).toEqual([
      'probe_static',
      'probe_rendered',
      'extract_links',
      'submit_plan',
    ])
    // search_brand is a recover-node step, not a model-callable tool.
    expect(tools.some((t) => t.name === 'search_brand')).toBe(false)
  })

  it('tool_refuses_url_outside_provenance_allowlist', async () => {
    const deps = makeDeps()
    const tools = createAcquisitionTools(deps, makeContext())

    const result = await callTool(tools, 'probe_static', { url: 'https://evil.example' })

    expect(result).toEqual({ error: 'not_in_allowlist' })
    expect(deps.fetchHtml).not.toHaveBeenCalled()
  })

  it('tool_summaries_are_bounded_and_exclude_raw_html', async () => {
    const longHtml = `<html><head><title>Big Page</title></head><body>${'a'.repeat(200_000)}</body></html>`
    const deps = makeDeps({
      fetchHtml: vi.fn().mockResolvedValue({ text: longHtml, status: 200, latencyMs: 50, error: null }),
    })
    const tools = createAcquisitionTools(
      deps,
      makeContext({ allowlist: { knownUrls: new Set(['https://big.example.com']), discoveredUrls: new Set() } }),
    )

    const result = await callTool(tools, 'probe_static', { url: 'https://big.example.com' })
    const json = JSON.stringify(result)

    expect(json.length).toBeLessThanOrEqual(1536)
    expect(json).not.toContain('<')
    expect(result).toHaveProperty('title')
    expect(result).toHaveProperty('textLength')
    expect(result).toHaveProperty('needsRendering')
  })

  it('extract_links_adds_returned_urls_to_allowlist', async () => {
    const html = '<html><body><a href="https://found.example.com/page">Link</a></body></html>'
    const deps = makeDeps({
      fetchHtml: vi.fn().mockResolvedValue({ text: html, status: 200, latencyMs: 50, error: null }),
    })
    const ctx = makeContext()
    const tools = createAcquisitionTools(deps, ctx)

    await callTool(tools, 'extract_links', { url: 'https://example.com' })
    expect(ctx.allowlist.discoveredUrls.has('https://found.example.com/page')).toBe(true)

    const probed = await callTool(tools, 'probe_static', { url: 'https://found.example.com/page' })
    expect(probed).not.toHaveProperty('error')
  })

  it('probe_tools_refuse_once_their_budget_kind_is_exhausted', async () => {
    const deps = makeDeps()
    const ctx = makeContext({ budget: makeBudget({ probes: 1, renders: 0 }) })
    const tools = createAcquisitionTools(deps, ctx)

    const first = await callTool(tools, 'probe_static', { url: 'https://example.com' })
    expect(first).not.toHaveProperty('error')
    expect(ctx.budget.used.probes).toBe(1)

    const second = await callTool(tools, 'probe_static', { url: 'https://example.com' })
    expect(second).toEqual({ error: 'budget_exhausted', kind: 'probes' })
    expect(deps.fetchHtml).toHaveBeenCalledTimes(1)

    const rendered = await callTool(tools, 'probe_rendered', { url: 'https://example.com' })
    expect(rendered).toEqual({ error: 'budget_exhausted', kind: 'renders' })
    expect(deps.renderProvider!.fetchRendered).not.toHaveBeenCalled()
  })

  it('probe_rendered_reports_a_provider_throw_without_crashing_the_loop', async () => {
    const deps = makeDeps({
      renderProvider: { fetchRendered: vi.fn().mockRejectedValue(new Error('browserless 429')) },
    })
    const onProviderError = vi.fn()
    const tools = createAcquisitionTools(deps, makeContext({ onProviderError }))

    const result = await callTool(tools, 'probe_rendered', { url: 'https://example.com' })

    expect(result.error).toContain('browserless 429')
    expect(onProviderError).toHaveBeenCalledTimes(1)
  })

  it('submit_plan_accepts_a_valid_plan_and_refuses_an_invalid_one', async () => {
    const submitted: AcquisitionPlanType[] = []
    const tools = createAcquisitionTools(
      makeDeps(),
      makeContext({ onPlanSubmitted: (plan) => submitted.push(plan) }),
    )

    const accepted = await callTool(tools, 'submit_plan', VALID_PLAN)
    expect(accepted).toMatchObject({ accepted: true })
    expect(submitted).toHaveLength(1)
    expect(submitted[0]!.surfaces).toHaveLength(1)

    // Seven real fetch targets breaks the plan-level refinement, which JSON
    // Schema cannot express — the tool has to answer the model itself.
    const overBudget = {
      ...VALID_PLAN,
      surfaces: Array.from({ length: 6 }, (_, i) => ({
        url: `https://example.com/${i}`,
        fetch: 'static',
        reason: `surface ${i}`,
      })),
      fanOut: ['https://extra.example/about'],
    }
    const refused = await callTool(tools, 'submit_plan', overBudget)
    expect(refused).toHaveProperty('error')
    expect(submitted).toHaveLength(1)
  })
})
