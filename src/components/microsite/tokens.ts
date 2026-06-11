import type { SiteTokens } from '@/lib/types/brand'

export function siteTokensToCssVars(tokens: SiteTokens): Record<string, string> {
  return {
    '--brand-accent': tokens.accent,
    '--brand-accent-foreground': tokens.accentForeground ?? '#FFFFFF',
  }
}
