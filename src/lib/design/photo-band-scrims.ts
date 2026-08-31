/**
 * THE SCRIM SPEC FOR PHOTOGRAPHIC BANDS — one source of truth, read by both
 * the component that paints it and the gate that proves it is legible.
 *
 * A photographic band is a photograph with copy on top of it. The copy needs a
 * contrast floor; the photograph needs to survive. A scrim is the negotiation,
 * and the whole history of getting it wrong here is a scrim tuned by eye and
 * then re-tuned by eye:
 *
 *   - The manifesto band shipped on a `/70` scrim whose body copy measured
 *     3.04:1 in the photograph's dark regions, under the 4.5:1 AA floor. It was
 *     found by hand, once, months after the fact.
 *   - The homepage opener shipped a flat `/85` sized off the WHOLE frame, when
 *     its copy occupies only the left 60% — the bright plaster wall. The scrim
 *     was therefore sized by the shelves nobody reads over, and bleached the
 *     photograph to roughly nothing.
 *   - Then the fix for that shipped a `textZone` of `[0, 0.72]` for every
 *     viewport, when 0.72 is a DESKTOP fact. See `BREAKPOINT_PX` below: under
 *     1123px the copy is capped by the viewport rather than by its own reading
 *     measure, so it ran to x=0.94 over a scrim that had already fallen to
 *     0.25 — a raw photograph under the tail of every line — while the gate
 *     reported the band green because it sampled only x <= 0.72.
 *
 * THE RULE THAT COMES OUT OF ALL THREE: the scrim tracks the TEXT BLOCK, not
 * the image, and the text block is a different shape at different widths.
 * Which is why a variant is named after a text alignment, and why it carries a
 * list of BREAKPOINTS rather than one set of stops — each breakpoint states
 * the span the copy actually occupies at that width, and the ramp that
 * protects it. Outside that span the scrim is free to thin out and let the
 * photograph read.
 *
 * WHAT MUST NOT HAPPEN AGAIN is per-image tuning. These stops are a CONTRACT:
 * a new band photograph must satisfy them, not the other way round.
 * `scripts/check-photo-band-contrast.ts` composites every band's real pixels
 * under these exact alphas, at EVERY breakpoint declared here, and fails
 * `pnpm lint` when the result drops under AA — so "pick a lighter crop" is the
 * remedy, never "nudge the opacity". The numbers live here and nowhere else:
 * the component derives its CSS from them and the gate derives its arithmetic
 * from them, so the two cannot disagree.
 */

/** Copy alignment, or `decorative` for a band with no overlaid copy. */
export type ScrimVariant = "left" | "center" | "flat" | "dark" | "decorative";

export type ScrimColorToken = "--ground" | "--surface-dark";

type ScrimStop = {
  /** Horizontal position across the band, 0 = left edge, 1 = right edge. */
  offset: number;
  /** Opacity of the variant's semantic colour at that position. */
  alpha: number;
};

/**
 * WHERE THE COPY STOPS BEING CAPPED BY ITS READING MEASURE AND STARTS BEING
 * CAPPED BY THE VIEWPORT — the one number that decides which set of stops a
 * band paints.
 *
 * Derived, not chosen: a band's copy sits in a `prose-measure` (48rem = 768px)
 * column inside `PageShell measure="page"`, whose gutter is `page-gutter-wide`
 * — 24px, then 40px from 48rem, then 104px from 80rem. The copy's right edge
 * is therefore `gutter + 768` until the viewport is wide enough for the column
 * to centre inside `page-measure`. Against the wide variant's 0.72 text zone:
 * (40 + 768) / 0.72 = 1122.2px, so 1123px is the first integer viewport width
 * at which the copy genuinely fits inside `[0, 0.72]`. Measured span of the
 * homepage opener's copy, for the record:
 *
 *   390px viewport  ->  0.062 .. 0.938 of the band
 *   768px viewport  ->  0.052 .. 0.948
 *   1024px viewport ->  0.039 .. 0.789
 *   1440px viewport ->  0.044 .. 0.578
 *
 * A round 1024 or 1280 would have left the 1024..1122 range unprotected, which
 * is the same class of defect as the one this fixes: a plausible number that
 * nothing measured.
 */
export const BREAKPOINT_PX = 1123;

export type ScrimBreakpoint = {
  /** Semantic colour composited over the photograph. */
  colorToken: ScrimColorToken;
  /**
   * The viewport width from which these stops paint, in px. `0` is the base
   * rule; anything higher is emitted as a `min-width` media query.
   */
  minWidth: number;
  /**
   * The horizontal span the copy occupies at this width, as fractions of the
   * band's width. The gate checks contrast HERE and nowhere else — a dark
   * region outside it carries no text, so darkening it is a picture, not a
   * defect.
   */
  textZone: [number, number];
  /**
   * The RENDERED band's aspect ratio (width / height) at this width, which is
   * part of the contract because `object-cover` crops against it: the browser
   * shows only the slice of the photograph that fits this ratio, and a gate
   * that measured the whole file would score pixels nobody sees.
   *
   * These are deliberate over-estimates of how much of the frame survives, so
   * the gate errs toward sampling pixels the browser crops away — a false
   * failure, which is loud, rather than a false pass, which is what shipped
   * twice. Wide: the homepage opener is roughly 1440x600 at desktop widths, so
   * a 2.4 band is at or under the real ratio and keeps more rows in the sample
   * than render. Narrow: at 390px the same band is roughly 390x640 (0.61), so
   * 0.75 keeps a wider horizontal slice in the sample than the browser shows.
   *
   * CEILING: they are arithmetic from the type scale and `py-section`, not
   * measurements from a running browser. If a band's proportions move far from
   * these — a band with a video, or a one-line manifesto — the upgrade path is
   * to state that band's own ratio here, not to widen these.
   */
  bandAspect: number;
  stops: ScrimStop[];
};

export type ScrimSpec = {
  /** Ordered by `minWidth`, ascending, starting at 0. */
  breakpoints: ScrimBreakpoint[];
};

export const PHOTO_BAND_SCRIMS: Record<ScrimVariant, ScrimSpec> = {
  /**
   * Left-aligned copy, photograph weighted right.
   *
   * WIDE (from `BREAKPOINT_PX`): THE RAMP STARTS AT THE MIDLINE, NOT AT THE
   * EDGE OF THE COPY. `0.72` is where the longest line of the homepage lede
   * ends, and holding full scrim out to there kept the photograph flat across
   * three quarters of the band — legible, and lifeless. The fall begins at
   * `0.50`, so the picture is already coming back under the tail of the
   * longest line rather than after it, and the tail reaches `0.15` instead of
   * `0.30`.
   *
   * `0.62` at x=0.72 is what that costs, and it is the BINDING NUMBER here:
   * over the homepage photograph it leaves body copy at 4.90:1 against a
   * 4.5:1 floor. Measured alternatives, same photograph, same gate — a ramp
   * from 0.40 gives 4.62:1 and one from 0.35 gives 4.19:1, which fails. So
   * this variant is close to its limit by design, and the margin belongs to
   * the photograph: a band that wants an earlier ramp needs a lighter frame,
   * not a thinner scrim.
   *
   * NARROW (base): none of that survives the viewport cap. The copy runs to
   * x=0.94, so there is no right-hand region left for the photograph to read
   * in, and a ramp there would only put the tail of every line on bare
   * picture. The scrim holds heavy to 0.95 and falls only in the last 5%,
   * which flattens the photograph on phones. That is the trade, taken
   * deliberately: on a 390px screen the band is a background for the copy, and
   * the picture is what remains once the copy is legible.
   */
  left: {
    breakpoints: [
      {
        colorToken: "--ground",
        minWidth: 0,
        textZone: [0, 0.95],
        bandAspect: 0.75,
        stops: [
          { offset: 0, alpha: 0.9 },
          { offset: 0.5, alpha: 0.88 },
          { offset: 0.95, alpha: 0.85 },
          { offset: 1, alpha: 0.7 },
        ],
      },
      {
        colorToken: "--ground",
        minWidth: BREAKPOINT_PX,
        textZone: [0, 0.72],
        bandAspect: 2.4,
        stops: [
          { offset: 0, alpha: 0.9 },
          { offset: 0.5, alpha: 0.85 },
          { offset: 0.72, alpha: 0.62 },
          { offset: 1, alpha: 0.15 },
        ],
      },
    ],
  },

  /**
   * Centred copy. SYMMETRIC, deliberately — a left-to-right ramp under centred
   * text lights one side of a headline and shadows the other, which is worse
   * than no gradient at all. Heavy through the middle, thinner at both edges.
   *
   * The narrow entry widens the plateau rather than changing its shape: centred
   * copy capped by the viewport reaches both gutters, so the edges the wide
   * entry gives back to the photograph are edges the copy is standing on.
   */
  center: {
    breakpoints: [
      {
        colorToken: "--ground",
        minWidth: 0,
        textZone: [0.05, 0.95],
        bandAspect: 0.75,
        stops: [
          { offset: 0, alpha: 0.8 },
          { offset: 0.05, alpha: 0.88 },
          { offset: 0.95, alpha: 0.88 },
          { offset: 1, alpha: 0.8 },
        ],
      },
      {
        colorToken: "--ground",
        minWidth: BREAKPOINT_PX,
        textZone: [0.25, 0.75],
        bandAspect: 2.4,
        stops: [
          { offset: 0, alpha: 0.45 },
          { offset: 0.25, alpha: 0.88 },
          { offset: 0.75, alpha: 0.88 },
          { offset: 1, alpha: 0.45 },
        ],
      },
    ],
  },

  /**
   * Uniform coverage. For a band whose copy can sit anywhere across the width,
   * or one not yet moved to a directional scrim. `textZone` is the full width
   * because a flat scrim makes no promise about where the copy is.
   *
   * Its two entries carry the SAME stops and zone and differ only in
   * `bandAspect`. That is not redundancy: `object-cover` shows a different
   * slice of the photograph at each shape, so the two are different pixels
   * under the same alphas, and both have to be measured.
   */
  flat: {
    breakpoints: [
      {
        colorToken: "--ground",
        minWidth: 0,
        textZone: [0, 1],
        bandAspect: 0.75,
        stops: [
          { offset: 0, alpha: 0.85 },
          { offset: 1, alpha: 0.85 },
        ],
      },
      {
        colorToken: "--ground",
        minWidth: BREAKPOINT_PX,
        textZone: [0, 1],
        bandAspect: 2.4,
        stops: [
          { offset: 0, alpha: 0.85 },
          { offset: 1, alpha: 0.85 },
        ],
      },
    ],
  },

  /**
   * Uniform warm-paper coverage for a copy-free atmospheric band. It keeps the
   * photograph present while retaining the same fail-closed contrast proof as
   * bands that carry copy; local opacity tuning remains forbidden.
   */
  decorative: {
    breakpoints: [
      {
        colorToken: "--ground",
        minWidth: 0,
        textZone: [0, 1],
        bandAspect: 0.75,
        stops: [
          { offset: 0, alpha: 0.7 },
          { offset: 1, alpha: 0.7 },
        ],
      },
      {
        colorToken: "--ground",
        minWidth: BREAKPOINT_PX,
        textZone: [0, 1],
        bandAspect: 2.4,
        stops: [
          { offset: 0, alpha: 0.7 },
          { offset: 1, alpha: 0.7 },
        ],
      },
    ],
  },

  /** Uniform warm-charcoal coverage for inverse copy over photography. */
  dark: {
    breakpoints: [
      {
        colorToken: "--surface-dark",
        minWidth: 0,
        textZone: [0, 1],
        bandAspect: 0.75,
        stops: [
          { offset: 0, alpha: 0.8 },
          { offset: 1, alpha: 0.8 },
        ],
      },
      {
        colorToken: "--surface-dark",
        minWidth: BREAKPOINT_PX,
        textZone: [0, 1],
        bandAspect: 2.4,
        stops: [
          { offset: 0, alpha: 0.8 },
          { offset: 1, alpha: 0.8 },
        ],
      },
    ],
  },
};

/**
 * The scrim's opacity at a horizontal position, linearly interpolated between
 * stops exactly as the CSS gradient does. The gate composites with this, so the
 * arithmetic it checks is the arithmetic the browser paints.
 */
export function scrimAlphaAt(breakpoint: ScrimBreakpoint, x: number): number {
  const { stops } = breakpoint;
  const clamped = Math.min(1, Math.max(0, x));

  const firstStop = stops[0];
  const lastStop = stops[stops.length - 1];
  if (!firstStop || !lastStop) {
    throw new Error(`scrim breakpoint ${breakpoint.minWidth} has no stops`);
  }
  if (clamped <= firstStop.offset) return firstStop.alpha;
  if (clamped >= lastStop.offset) return lastStop.alpha;

  for (let i = 1; i < stops.length; i += 1) {
    const previous = stops[i - 1];
    const next = stops[i];
    if (!previous || !next) continue;
    if (clamped > next.offset) continue;

    const span = next.offset - previous.offset;
    if (span === 0) return next.alpha;
    const t = (clamped - previous.offset) / span;
    return previous.alpha + (next.alpha - previous.alpha) * t;
  }

  return lastStop.alpha;
}

/** Every breakpoint a variant declares, ascending. */
export function scrimBreakpoints(variant: ScrimVariant): ScrimBreakpoint[] {
  return PHOTO_BAND_SCRIMS[variant].breakpoints;
}

/**
 * The scrim as a CSS `background-image`, for ONE breakpoint.
 *
 * `color-mix` against the breakpoint's semantic token rather than a hard-coded
 * rgba: the band follows the design system, and a literal would drift the
 * moment that token moves. A flat scrim is a two-stop gradient of one colour
 * rather than a special case — one code path paints every variant.
 *
 * Four decimals, not one. Every stop today is exact at one, but `toFixed(1)`
 * would round a future `0.6249` to 62.5% in the browser while the gate
 * composited 0.6249 — a silent disagreement between the paint and the proof,
 * in the one direction this module promises is impossible.
 */
export function scrimBackgroundImage(breakpoint: ScrimBreakpoint): string {
  const stops = breakpoint.stops
    .map(
      ({ offset, alpha }) =>
        `color-mix(in srgb, var(${breakpoint.colorToken}) ${(alpha * 100).toFixed(4)}%, transparent) ${(offset * 100).toFixed(4)}%`,
    )
    .join(", ");

  return `linear-gradient(to right, ${stops})`;
}

/** The class a band's scrim element wears. One per variant, stable. */
export function scrimClassName(variant: ScrimVariant): string {
  return `photo-band-scrim-${variant}`;
}

/**
 * THE VARIANT'S RULES, AS A STYLESHEET — because a breakpoint-aware scrim
 * cannot be an inline `style`.
 *
 * React's `style` prop holds declarations, not media queries, so a spec with
 * per-width stops has to reach the browser as real CSS. The two candidates
 * were generating these rules into `globals.css` from this module, and
 * emitting them from the component. This is the second: codegen adds a step
 * that can be skipped, and a stylesheet that drifts from the spec is exactly
 * the disagreement between paint and proof the docblock above forbids.
 * `PhotoBand` is a server component, so the emitted markup is deterministic
 * and there is no client JavaScript in this path.
 *
 * It is written with `min-width`, not `width >=`, and asserts as much: React
 * escapes `<`, `>` and `&` in element text, and a browser reading `<style>` as
 * raw text would then see `&gt;` and drop the rule — a scrim that silently
 * fails to paint. The assertion is what keeps that from being discovered on
 * the page.
 *
 * CEILING: two bands of the same variant on one route emit the same rules
 * twice. Two bands exist site-wide and they differ, so the duplicate is
 * theoretical; the upgrade path if it stops being theoretical is React 19's
 * `<style href precedence>` hoisting, which dedupes by href.
 */
export function scrimStyleRules(variant: ScrimVariant): string {
  const selector = `.${scrimClassName(variant)}`;
  const css = scrimBreakpoints(variant)
    .map((breakpoint) => {
      const rule = `${selector}{background-image:${scrimBackgroundImage(breakpoint)}}`;
      return breakpoint.minWidth <= 0
        ? rule
        : `@media (min-width:${breakpoint.minWidth}px){${rule}}`;
    })
    .join("");

  if (/[<>&]/.test(css)) {
    throw new Error(
      `scrim CSS for "${variant}" contains a character React escapes in element text; write the media query with min-width`,
    );
  }

  return css;
}
