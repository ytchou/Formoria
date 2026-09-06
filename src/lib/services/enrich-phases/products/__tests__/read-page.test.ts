import { describe, expect, it, vi } from 'vitest'

import { readProductPage, MAX_MAIN_TEXT_CHARS } from '../read-page'
import { PRODUCTS_BUDGET_CEILINGS, type ProductsBudgetState } from '../budget'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PAGE_URL = 'https://brand.example/products/clay-plate'

/** Server-rendered page: og tags, a Product JSON-LD block, real body text. */
const STATIC_HTML = `<html><head>
<title>Clay Plate</title>
<meta property="og:title" content="Clay Plate - Island Studio" />
<meta property="og:description" content="Nantou clay, 21cm across" />
<meta property="og:image" content="/img/plate-og.jpg" />
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Clay Plate","image":["https://brand.example/img/plate-large.jpg"]}</script>
</head><body><main><h1>Clay Plate</h1><p>Made in Taiwan by a Nantou studio. Diameter 21cm, unglazed rim.</p></main></body></html>`

/**
 * A JS shell: one mount point and a one-character script. `needsRendering`
 * reads `$('body').text()`, which INCLUDES script text, so the script body has
 * to stay under the 20-character floor for this to look like a shell.
 */
const SHELL_HTML = `<html><head><title>Loading</title></head><body><div id="root"></div><script>x</script></body></html>`

const RENDERED_HTML = `<html><head><title>Clay Plate</title>
<meta property="og:image" content="https://cdn.brand.example/plate.jpg" />
</head><body><main><h1>Clay Plate</h1><p>Hydrated by the client. Made in Taiwan, diameter 21cm.</p></main></body></html>`

function makeBudget(usedRenders = 0): ProductsBudgetState {
  return {
    allowed: { reads: 12, renders: PRODUCTS_BUDGET_CEILINGS.renders, turns: 6, wallClockMs: 120_000 },
    used: { reads: 0, renders: usedRenders, turns: 0, wallClockMs: 0 },
  }
}

function makeDeps(html: string, usedRenders = 0) {
  const fetchHtml = vi.fn().mockResolvedValue({ text: html, statusCode: 200 })
  const fetchRendered = vi.fn().mockResolvedValue({
    html: RENDERED_HTML,
    finalUrl: PAGE_URL,
    status: 200,
  })
  return {
    fetchHtml,
    renderProvider: { fetchRendered },
    budget: makeBudget(usedRenders),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('readProductPage', () => {
  it('read_page_extracts_structured_evidence_and_renders_when_needed', async () => {
    // 1. A static page yields structured evidence and spends no render.
    const staticDeps = makeDeps(STATIC_HTML)
    const staticEvidence = await readProductPage(PAGE_URL, staticDeps)

    expect(staticDeps.renderProvider.fetchRendered).not.toHaveBeenCalled()
    expect(staticEvidence.rendered).toBe(false)
    expect(staticDeps.budget.used.renders).toBe(0)
    expect(staticEvidence.url).toBe(PAGE_URL)
    expect(staticEvidence.statusCode).toBe(200)
    expect(staticEvidence.title).toBe('Clay Plate - Island Studio')
    expect(staticEvidence.description).toBe('Nantou clay, 21cm across')
    expect(staticEvidence.mainText).toContain('Made in Taiwan')
    expect(staticEvidence.jsonLd).toMatchObject({ '@type': 'Product' })
    expect(staticEvidence.productSignals).toBe(true)
    // Both the JSON-LD image and the og:image, the latter resolved absolute.
    expect(staticEvidence.images).toEqual(
      expect.arrayContaining([
        'https://brand.example/img/plate-large.jpg',
        'https://brand.example/img/plate-og.jpg',
      ]),
    )

    // 2. A JS shell spends exactly one render and reports it.
    const shellDeps = makeDeps(SHELL_HTML)
    const shellEvidence = await readProductPage(PAGE_URL, shellDeps)

    expect(shellDeps.renderProvider.fetchRendered).toHaveBeenCalledTimes(1)
    expect(shellDeps.renderProvider.fetchRendered).toHaveBeenCalledWith(PAGE_URL)
    expect(shellEvidence.rendered).toBe(true)
    expect(shellDeps.budget.used.renders).toBe(1)
    expect(shellEvidence.mainText).toContain('Hydrated by the client')
    expect(shellEvidence.images).toContain('https://cdn.brand.example/plate.jpg')

    // 3. The fifth render is refused: the ceiling is four per brand.
    const exhaustedDeps = makeDeps(SHELL_HTML, PRODUCTS_BUDGET_CEILINGS.renders)
    const exhaustedEvidence = await readProductPage(PAGE_URL, exhaustedDeps)

    expect(exhaustedDeps.renderProvider.fetchRendered).not.toHaveBeenCalled()
    expect(exhaustedEvidence.rendered).toBe(false)
    expect(exhaustedDeps.budget.used.renders).toBe(PRODUCTS_BUDGET_CEILINGS.renders)
  })

  it('read_page_never_renders_without_a_provider', async () => {
    const fetchHtml = vi.fn().mockResolvedValue({ text: SHELL_HTML, statusCode: 200 })
    const budget = makeBudget()

    const evidence = await readProductPage(PAGE_URL, { fetchHtml, budget })

    expect(evidence.rendered).toBe(false)
    expect(budget.used.renders).toBe(0)
  })

  it('read_page_survives_a_render_failure', async () => {
    const deps = makeDeps(SHELL_HTML)
    deps.renderProvider.fetchRendered.mockRejectedValue(new Error('browserless 429'))

    const evidence = await readProductPage(PAGE_URL, deps)

    // The static body is still returned rather than the read throwing.
    expect(evidence.rendered).toBe(false)
    expect(evidence.statusCode).toBe(200)
    // The attempt is charged: a failed render still cost the provider a slot.
    expect(deps.budget.used.renders).toBe(1)
  })

  it('read_page_caps_main_text', async () => {
    const long = `<html><body><main><p>${'word '.repeat(4000)}</p></main></body></html>`
    const deps = makeDeps(long)

    const evidence = await readProductPage(PAGE_URL, deps)

    expect(evidence.mainText.length).toBe(MAX_MAIN_TEXT_CHARS)
  })

  it('read_page_builds_origin_excerpts_from_loadOriginTexts', async () => {
    const deps = makeDeps(STATIC_HTML)
    const loadOriginTexts = vi
      .fn()
      .mockResolvedValue(new Map([[PAGE_URL, 'This plate is made in Taiwan, in Nantou.']]))

    const evidence = await readProductPage(PAGE_URL, {
      ...deps,
      loadOriginTexts,
      candidateId: 'cand-1',
    })

    expect(loadOriginTexts).toHaveBeenCalledWith([PAGE_URL])
    expect(evidence.originExcerpts.length).toBeGreaterThan(0)
    expect(evidence.originExcerpts[0]!.id).toContain('cand-1')
    expect(evidence.originExcerpts[0]!.text).toContain('made in Taiwan')
  })

  it('read_page_falls_back_to_page_text_for_origin_excerpts', async () => {
    // No `loadOriginTexts`: the excerpts still come from the page just read,
    // rather than the origin check silently having no input at all.
    const deps = makeDeps(STATIC_HTML)

    const evidence = await readProductPage(PAGE_URL, deps)

    expect(evidence.originExcerpts.length).toBeGreaterThan(0)
    expect(evidence.originExcerpts[0]!.text).toContain('Made in Taiwan')
  })

  it('read_page_reports_a_failed_fetch_without_throwing', async () => {
    const fetchHtml = vi.fn().mockResolvedValue({ text: '', statusCode: 503 })
    const budget = makeBudget()

    const evidence = await readProductPage(PAGE_URL, { fetchHtml, budget })

    expect(evidence.statusCode).toBe(503)
    expect(evidence.mainText).toBe('')
    expect(evidence.images).toEqual([])
    expect(evidence.productSignals).toBe(false)
  })
})
