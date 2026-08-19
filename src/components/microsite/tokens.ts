import type { SiteTokens } from '@/lib/types/brand'

/**
 * THE ONE DOCUMENTED EXCEPTION TO THE SYSTEM PALETTE (DESIGN.md §2).
 *
 * These values come from `brands.site_content -> tokens -> accent`, a jsonb
 * path rather than a column. They are the BRAND's property and sit
 * deliberately outside design system v2 — a microsite that repainted a brand's
 * colour in Formoria's indigo would be Formoria wearing the brand's name.
 *
 * Do not import `@/lib/brand/colors` here, and do not "finish the job" by
 * defaulting `accent` to the system accent token. `registry.test.ts` asserts
 * both, by name and by value.
 */
export function siteTokensToCssVars(tokens: SiteTokens): Record<string, string> {
  return {
    '--brand-accent': tokens.accent,
    '--brand-accent-foreground': tokens.accentForeground ?? '#FFFFFF',
  }
}
