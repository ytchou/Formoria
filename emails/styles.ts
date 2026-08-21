import { getSiteUrl } from '../src/lib/site-url'

/**
 * THE ENTIRE EMAIL TOKEN SURFACE. Nothing else in `emails/` may write a colour,
 * a face, a size or a radius — a test renders every template and fails on any
 * hex this file does not export.
 *
 * D17 — SANS ONLY, AND NO WEBFONT, EVER. Mail clients strip embedded font
 * declarations, so a CJK webfont cannot ship here and no Ming face is ever
 * named. Email aligns with design system v2 through COLOUR, SPACING and
 * LAYOUT instead: the warm paper ground, the ink ramp, hairline rules in place
 * of boxes and shadows, and the same 24 / 32 / 48 rhythm.
 *
 * Names are the v2 ROLES from `src/app/globals.css`, not descriptions of their
 * own values. The v1 names described values and went stale the moment a value
 * moved: `KILN` survived three palette changes still calling indigo a fired
 * clay, and `BG_WARM_WHITE` outlived the white it was named for.
 */

/* ── Colour — the v2 ramp, mirrored from globals.css ─────────────────────── */

/** The page. Warm paper. `--ground` */
export const GROUND = '#FAF7F2'
/** The second material: inset blocks and quoted matter. `--surface` */
export const SURFACE = '#F1EAE0'
/** Primary text — headings and the wordmark. `--ink` */
export const INK = '#1A1815'
/** Body prose. `--ink-soft` */
export const INK_SOFT = '#4A443C'
/** Metadata, footer, captions. `--ink-muted` */
export const INK_MUTED = '#6F685F'
/** Hairlines. Elevation is the rule; in v2 nothing floats. `--rule` */
export const RULE = '#DED5C8'
/** 藍染 indigo, interaction only — links and the one CTA. `--accent` */
export const ACCENT = '#2F4F63'
/** Text on an accent fill, matching the site's `bg-accent text-ground`. */
export const ON_ACCENT = '#FAF7F2'

/* ── Spacing — the v2 rhythm, re-based for a 600px column ────────────────── */

/**
 * `--space-section` is 96px on a 1280px page. At 600px that is a sixth of the
 * whole width and reads as a broken message rather than a section break, so
 * the section step halves. Stack and gutter carry their page values unchanged.
 */
export const SPACE_SECTION = '48px'
/** `--space-stack` — between blocks inside a section. */
export const SPACE_STACK = '32px'
/** `--space-gutter` — between a block and the next line of type. */
export const SPACE_GUTTER = '24px'

/* ── Radius — 4px on controls, 2–3px on surfaces ─────────────────────────── */

export const RADIUS_CONTROL = '4px'
export const RADIUS_SURFACE = '3px'
/** Chips and pills are the stated exception to the paper edge. */
export const RADIUS_PILL = '999px'

/* ── Type — one sans scale carrying both v2 faces' roles ─────────────────── */

/**
 * v2 splits type across 明體 (content) and 黑體 (interface). Email cannot, so
 * the two scales collapse into one sans ramp that keeps the v2 SIZES: 26 for
 * the page title, 21 for a section, 16 for body, 13 and 12 for metadata.
 *
 * The v2 body role is 16.5px. It is rounded to a whole pixel here because
 * Outlook renders through the Word engine, which rounds fractional px
 * unpredictably — a half-pixel that survives on the web is a rendering lottery
 * in mail.
 */
export const FONT_SIZE_TITLE = '26px'
export const LINE_HEIGHT_TITLE = '34px'
export const FONT_SIZE_HEADING = '21px'
export const LINE_HEIGHT_HEADING = '28px'
export const FONT_SIZE_BODY = '16px'
export const LINE_HEIGHT_BODY = '28px'
export const FONT_SIZE_META = '13px'
export const LINE_HEIGHT_META = '20px'
export const FONT_SIZE_MICRO = '12px'
export const LINE_HEIGHT_MICRO = '18px'

/**
 * Every family here ships WITH an operating system. Nothing is fetched, and
 * `emails/` emits no embedded font declaration anywhere — mail clients strip
 * them, so the rule is enforced by a source scan and not left to taste.
 * `Noto Sans CJK TC` is the name Linux and Android install locally — it is not
 * the `Noto Sans TC` webfont the site loads through `next/font`.
 */
export const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang TC', 'Heiti TC', 'Microsoft JhengHei', 'Noto Sans CJK TC', sans-serif"

export const FROM_ADDRESS = 'Formoria <noreply@formoria.com>'
export const SITE_URL = getSiteUrl()
