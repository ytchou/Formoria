/**
 * Acquisition agent tools — LangChain `tool()` definitions bound to the plan
 * node's model and executed by a LangGraph `ToolNode`.
 *
 * Every tool enforces two things before it does any work: the provenance
 * allowlist (a URL the agent was never given is not fetchable) and the budget
 * for its own kind. Both refusals are returned to the model as `{ error }` so a
 * refused call is a turn the model can learn from, not a crashed graph.
 *
 * `search_brand` is deliberately NOT here. Search is a recover-node step the
 * critique requests through `recoveryAction`, so the one-shot latch and the
 * "recovery only" rule are structural rather than a phase string the model
 * passes to itself.
 */

import * as cheerio from 'cheerio'
import { z } from 'zod'
import { tool, type StructuredToolInterface } from '@langchain/core/tools'
import type { JSONSchema } from '@langchain/core/utils/json_schema'
import type { FetchMetadata } from '../scraper/fetch-guards'
import type { RenderProvider } from '../scraper/render/types'
import { needsRendering } from '../catalog-discovery'
import { toStrictJsonSchema } from '../../_shared/zod-schema'
import { assertBudget, type BudgetKind, type BudgetState } from './budget'
import { AcquisitionPlan, boundedPlan, type AcquisitionPlanType } from './plan'

const MAX_SUMMARY_BYTES = 1536 // 1.5 KB

export type SearchResult = {
  urls: string[]
  snippets: string[]
}

export type AcquisitionToolDeps = {
  fetchHtml: (url: string) => Promise<FetchMetadata>
  renderProvider?: RenderProvider
}

export type ProvenanceAllowlist = {
  knownUrls: Set<string>
  discoveredUrls: Set<string>
}

export type AcquisitionToolContext = {
  allowlist: ProvenanceAllowlist
  /** Shared with the graph: tools spend the same allowance the nodes report. */
  budget: BudgetState
  /** A render provider that threw — feeds `providerFailure` (Gate A). */
  onProviderError?: (kind: 'render', message: string) => void
  /** A page title worth keeping as a name candidate. */
  onPageTitle?: (url: string, title: string) => void
  /** A plan that parsed and validated. The plan node reads it after the loop. */
  onPlanSubmitted?: (plan: AcquisitionPlanType) => void
}

type ToolResult = Record<string, unknown>

function isInAllowlist(url: string, allowlist: ProvenanceAllowlist): boolean {
  return allowlist.knownUrls.has(url) || allowlist.discoveredUrls.has(url)
}

/** `{ error }` when the kind is spent, `null` when the spend was recorded. */
function spend(budget: BudgetState, kind: BudgetKind): ToolResult | null {
  try {
    assertBudget(budget, kind)
  } catch {
    return { error: 'budget_exhausted', kind }
  }
  budget.used[kind] += 1
  return null
}

/**
 * Extracts a bounded summary from HTML. Includes title, textLength,
 * scriptCount, needsRendering, platform hints, and discovered links.
 * Never includes raw HTML. Truncates to 1.5 KB.
 */
function summarizeHtml(html: string, url: string): ToolResult {
  const $ = cheerio.load(html)
  const title = $('title').first().text().trim().slice(0, 120) || null
  const bodyText = $('body').text().replace(/\s+/gu, ' ').trim()
  const scriptCount = $('script').length

  // Extract links (absolute URLs only, deduplicated)
  const links: string[] = []
  $('a[href]').each((_, el) => {
    try {
      const href = $(el).attr('href')
      if (!href) return
      const resolved = new URL(href, url).href
      if (resolved.startsWith('http') && !links.includes(resolved)) {
        links.push(resolved)
      }
    } catch {
      // invalid URL, skip
    }
  })

  // Detect platform from meta tags
  const ogSiteName = $('meta[property="og:site_name"]').attr('content')?.trim() || null
  const generator = $('meta[name="generator"]').attr('content')?.trim() || null

  const summary: ToolResult = {
    title,
    textLength: bodyText.length,
    scriptCount,
    needsRendering: needsRendering(html),
    platform: ogSiteName || generator,
    links: links.slice(0, 20),
  }

  // Ensure we stay under the byte limit
  let json = JSON.stringify(summary)
  if (json.length > MAX_SUMMARY_BYTES) {
    // Trim links first
    summary.links = (summary.links as string[]).slice(0, 5)
    json = JSON.stringify(summary)
  }
  if (json.length > MAX_SUMMARY_BYTES) {
    summary.links = []
    json = JSON.stringify(summary)
  }

  return summary
}

const urlArg = z.object({
  url: z.string().describe('An absolute URL that is already in the provenance allowlist.'),
})

/**
 * The four model-callable tools, bound to injected dependencies and a shared
 * provenance allowlist. The allowlist grows as `extract_links` discovers URLs.
 */
export function createAcquisitionTools(
  deps: AcquisitionToolDeps,
  ctx: AcquisitionToolContext,
): StructuredToolInterface[] {
  const probeStatic = tool(
    async ({ url }: { url: string }) => {
      if (!isInAllowlist(url, ctx.allowlist)) return JSON.stringify({ error: 'not_in_allowlist' })
      const refusal = spend(ctx.budget, 'probes')
      if (refusal) return JSON.stringify(refusal)
      try {
        const result = await deps.fetchHtml(url)
        if (result.error || !result.text) {
          return JSON.stringify({ error: result.error || 'empty_response', status: result.status })
        }
        const summary = summarizeHtml(result.text, url)
        if (typeof summary.title === 'string') ctx.onPageTitle?.(url, summary.title)
        return JSON.stringify(summary)
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : 'fetch_failed' })
      }
    },
    {
      name: 'probe_static',
      description:
        'Fetches a URL statically and returns a bounded summary (title, text length, scripts, links). The URL must be in the provenance allowlist.',
      schema: urlArg,
    },
  )

  const probeRendered = tool(
    async ({ url }: { url: string }) => {
      if (!isInAllowlist(url, ctx.allowlist)) return JSON.stringify({ error: 'not_in_allowlist' })
      if (!deps.renderProvider) return JSON.stringify({ error: 'no_render_provider' })
      const refusal = spend(ctx.budget, 'renders')
      if (refusal) return JSON.stringify(refusal)
      try {
        const result = await deps.renderProvider.fetchRendered(url)
        const summary = summarizeHtml(result.html, result.finalUrl)
        if (typeof summary.title === 'string') ctx.onPageTitle?.(url, summary.title)
        return JSON.stringify(summary)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'render_failed'
        ctx.onProviderError?.('render', message)
        return JSON.stringify({ error: message })
      }
    },
    {
      name: 'probe_rendered',
      description:
        'Renders a URL with a headless browser and returns a bounded summary. Costs one render from the budget. The URL must be in the provenance allowlist.',
      schema: urlArg,
    },
  )

  const extractLinks = tool(
    async ({ url }: { url: string }) => {
      if (!isInAllowlist(url, ctx.allowlist)) return JSON.stringify({ error: 'not_in_allowlist' })
      const refusal = spend(ctx.budget, 'probes')
      if (refusal) return JSON.stringify(refusal)
      try {
        const result = await deps.fetchHtml(url)
        if (!result.text) return JSON.stringify({ error: 'empty_response', links: [] })
        const $ = cheerio.load(result.text)
        const links: string[] = []
        $('a[href]').each((_, el) => {
          try {
            const href = $(el).attr('href')
            if (!href) return
            const resolved = new URL(href, url).href
            if (resolved.startsWith('http') && !links.includes(resolved)) {
              links.push(resolved)
              // Grow the allowlist
              ctx.allowlist.discoveredUrls.add(resolved)
            }
          } catch {
            // invalid URL
          }
        })
        return JSON.stringify({ links: links.slice(0, 30) })
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : 'extract_failed',
          links: [],
        })
      }
    },
    {
      name: 'extract_links',
      description:
        'Extracts navigation and content links from a page. Discovered links become probeable (they join the provenance allowlist).',
      schema: urlArg,
    },
  )

  /**
   * The plan's own schema is the tool's argument schema, passed as JSON Schema
   * rather than Zod: the plan carries a cross-field refinement (total fetch
   * targets ≤ 6) that JSON Schema cannot express. Under a Zod schema LangChain
   * would run that refinement itself and throw, so the model would get a parser
   * exception instead of the tool's own message — and the plan node could not
   * tell a rejected payload from a crashed tool.
   *
   * The cast is the seam between two JSON-Schema types: our converter returns a
   * plain record, LangChain wants its structural `JSONSchema` union. Both
   * describe the same draft-7 document.
   */
  const submitPlanSchema = toStrictJsonSchema(AcquisitionPlan) as unknown as JSONSchema

  const submitPlan = tool(
    async (args: unknown) => {
      const result = AcquisitionPlan.safeParse(args)
      if (!result.success) {
        return JSON.stringify({
          error: 'invalid_plan',
          reason: result.error.message.slice(0, 400),
        })
      }
      const plan = boundedPlan(result.data)
      ctx.onPlanSubmitted?.(plan)
      return JSON.stringify({
        accepted: true,
        surfaces: plan.surfaces.length,
        fanOut: plan.fanOut.length,
      })
    },
    {
      name: 'submit_plan',
      description:
        'Submits the final acquisition plan. Call this exactly once, after any probing, to end the planning step.',
      schema: submitPlanSchema,
    },
  )

  return [probeStatic, probeRendered, extractLinks, submitPlan] as unknown as StructuredToolInterface[]
}
