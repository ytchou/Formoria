/**
 * Marks repeated/aggregate copy (card blurbs, list rows) ineligible as a Google
 * SERP snippet source, so Google falls back to the page meta description.
 *
 * Only for text that is NOT the page's main answer — a brand blurb on a brand
 * card qualifies, the same brand's description on its own detail page does not.
 * Over-applying this weakens every result the page can win (DEV-1320).
 *
 * Must render server-side; Google ignores attributes added by client JS.
 */
export const NO_SNIPPET = { 'data-nosnippet': '' } as const
