/**
 * THE V2 PALETTE FOR `next/og`, WHICH CANNOT IMPORT A CSS TOKEN.
 *
 * Satori resolves inline styles and nothing else — there is no stylesheet to
 * read `--ground` from — so these five routes carry the only sanctioned second
 * copy of the palette. `src/lib/brand/colors.test.ts` asserts each value
 * against `src/app/globals.css`, which is what keeps a second copy from
 * becoming a second palette. v1 had four of those.
 *
 * Named for the v2 ROLES. The v1 keys had all outlived their values: `cta`
 * held the accent, `espresso` held a plain grey, `primary` was a duplicate of
 * `fg`, and `bg` was a paper white this palette no longer ships.
 */
export const brand = {
  /** `--ground` — the card. Warm paper. */
  ground: "#FAF7F2",
  /** `--surface` — bands and inset blocks. */
  surface: "#F1EAE0",
  /** `--ink` — the wordmark, the brand name, the headline. */
  ink: "#1A1815",
  /** `--ink-soft` — supporting prose. */
  inkSoft: "#4A443C",
  /** `--ink-muted` — taglines, categories, metadata. */
  inkMuted: "#6F685F",
  /** `--rule` — hairlines. Elevation is the rule; nothing floats. */
  rule: "#DED5C8",
  /** `--accent` — indigo-dye. The stripe and the one label that marks origin. */
  accent: "#2F4F63",
} as const;
