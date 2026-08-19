import type { SiteTokens } from '@/lib/types/brand'

/**
 * THE ONE DOCUMENTED EXCEPTION TO THE SYSTEM PALETTE (DESIGN.md §2).
 *
 * These values come from `brands.site_content -> tokens -> accent`, a jsonb
 * path rather than a column. They are the BRAND's property and sit
 * deliberately outside design system v2 — a microsite that repainted a brand's
 * colour in Formoria's indigo would be Formoria wearing the brand's name.
 *
 * Do not import the system palette module here, and do not "finish the job"
 * by defaulting `accent` to the system accent token. `registry.test.ts`
 * asserts both — by scanning this file for the palette import specifier and
 * for the accent literal, which is why neither may be written out even inside
 * a comment.
 */
export function siteTokensToCssVars(tokens: SiteTokens): Record<string, string> {
  return {
    '--brand-accent': tokens.accent,
    '--brand-accent-foreground': tokens.accentForeground ?? '#FFFFFF',
  }
}
