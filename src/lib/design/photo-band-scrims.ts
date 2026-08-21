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
 *
 * THE RULE THAT COMES OUT OF BOTH: the scrim tracks the TEXT BLOCK, not the
 * image. Which is why a variant is named after a text alignment and carries a
 * `textZone` — the horizontal span the copy actually occupies. Outside that
 * span the scrim is free to thin out and let the photograph read.
 *
 * WHAT MUST NOT HAPPEN AGAIN is per-image tuning. These stops are a CONTRACT:
 * a new band photograph must satisfy them, not the other way round.
 * `scripts/check-photo-band-contrast.ts` composites every band's real pixels
 * under these exact alphas and fails `pnpm lint` when the result drops under
 * AA — so "pick a lighter crop" is the remedy, never "nudge the opacity". The
 * numbers live here and nowhere else: the component derives its CSS from them
 * and the gate derives its arithmetic from them, so the two cannot disagree.
 */

/** Named after the alignment of the copy the scrim is protecting. */
export type ScrimVariant = "left" | "center" | "flat";

type ScrimStop = {
  /** Horizontal position across the band, 0 = left edge, 1 = right edge. */
  offset: number;
  /** Opacity of `--ground` at that position. */
  alpha: number;
};

export type ScrimSpec = {
  stops: ScrimStop[];
  /**
   * The horizontal span the copy occupies, as fractions of the band's width.
   * The gate checks contrast HERE and nowhere else — a dark region outside it
   * carries no text, so darkening it is a picture, not a defect.
   */
  textZone: [number, number];
};

export const PHOTO_BAND_SCRIMS: Record<ScrimVariant, ScrimSpec> = {
  /**
   * Left-aligned copy, photograph weighted right.
   *
   * THE RAMP STARTS AT THE MIDLINE, NOT AT THE EDGE OF THE COPY. `0.72` is
   * where the longest line of the homepage lede ends, and holding full scrim
   * out to there kept the photograph flat across three quarters of the band —
   * legible, and lifeless. The fall now begins at `0.50`, so the picture is
   * already coming back under the tail of the longest line rather than after
   * it, and the tail reaches `0.15` instead of `0.30`.
   *
   * `0.62` at x=0.72 is what that costs, and it is the BINDING NUMBER here:
   * over the homepage photograph it leaves body copy at 4.90:1 against a
   * 4.5:1 floor. Measured alternatives, same photograph, same gate — a ramp
   * from 0.40 gives 4.62:1 and one from 0.35 gives 4.19:1, which fails. So
   * this variant is close to its limit by design, and the margin belongs to
   * the photograph: a band that wants an earlier ramp needs a lighter frame,
   * not a thinner scrim.
   */
  left: {
    stops: [
      { offset: 0, alpha: 0.9 },
      { offset: 0.5, alpha: 0.85 },
      { offset: 0.72, alpha: 0.62 },
      { offset: 1, alpha: 0.15 },
    ],
    textZone: [0, 0.72],
  },

  /**
   * Centred copy. SYMMETRIC, deliberately — a left-to-right ramp under centred
   * text lights one side of a headline and shadows the other, which is worse
   * than no gradient at all. Heavy through the middle, thinner at both edges.
   */
  center: {
    stops: [
      { offset: 0, alpha: 0.45 },
      { offset: 0.25, alpha: 0.88 },
      { offset: 0.75, alpha: 0.88 },
      { offset: 1, alpha: 0.45 },
    ],
    textZone: [0.25, 0.75],
  },

  /**
   * Uniform coverage. For a band whose copy can sit anywhere across the width,
   * or one not yet moved to a directional scrim. `textZone` is the full width
   * because a flat scrim makes no promise about where the copy is.
   */
  flat: {
    stops: [
      { offset: 0, alpha: 0.85 },
      { offset: 1, alpha: 0.85 },
    ],
    textZone: [0, 1],
  },
};

/**
 * The scrim's opacity at a horizontal position, linearly interpolated between
 * stops exactly as the CSS gradient does. The gate composites with this, so the
 * arithmetic it checks is the arithmetic the browser paints.
 */
export function scrimAlphaAt(variant: ScrimVariant, x: number): number {
  const { stops } = PHOTO_BAND_SCRIMS[variant];
  const clamped = Math.min(1, Math.max(0, x));

  const firstStop = stops[0];
  const lastStop = stops[stops.length - 1];
  if (!firstStop || !lastStop) {
    throw new Error(`scrim "${variant}" has no stops`);
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

/**
 * The scrim as a CSS `background-image`.
 *
 * `color-mix` against `var(--ground)` rather than a hard-coded rgba: the band
 * has to follow the page's own background token, and a literal would drift the
 * moment that token moves. A flat scrim is a two-stop gradient of one colour
 * rather than a special case — one code path paints every variant.
 */
export function scrimBackgroundImage(variant: ScrimVariant): string {
  const stops = PHOTO_BAND_SCRIMS[variant].stops
    .map(
      ({ offset, alpha }) =>
        `color-mix(in srgb, var(--ground) ${(alpha * 100).toFixed(1)}%, transparent) ${(offset * 100).toFixed(1)}%`,
    )
    .join(", ");

  return `linear-gradient(to right, ${stops})`;
}
