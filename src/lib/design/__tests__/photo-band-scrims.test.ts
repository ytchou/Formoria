import { describe, expect, it } from "vitest";

import {
  PHOTO_BAND_SCRIMS,
  scrimAlphaAt,
  scrimBackgroundImage,
  type ScrimVariant,
} from "@/lib/design/photo-band-scrims";

const VARIANTS = Object.keys(PHOTO_BAND_SCRIMS) as ScrimVariant[];

/**
 * The interpolation is the seam between what the browser paints and what
 * `scripts/check-photo-band-contrast.ts` measures. If it drifts, the gate keeps
 * passing while the page gets darker — the exact failure mode the gate exists
 * to remove — so the arithmetic is pinned here rather than trusted.
 */
describe("scrimAlphaAt", () => {
  it("returns the stop's own alpha at each stop", () => {
    for (const variant of VARIANTS) {
      for (const stop of PHOTO_BAND_SCRIMS[variant].stops) {
        expect(scrimAlphaAt(variant, stop.offset)).toBeCloseTo(stop.alpha, 5);
      }
    }
  });

  it("interpolates linearly between stops", () => {
    // `left` runs 0.90 at x=0 to 0.85 at x=0.50, so the midpoint is 0.875.
    expect(scrimAlphaAt("left", 0.25)).toBeCloseTo(0.875, 5);
    // and 0.62 to 0.15 across the last 28%, so 0.86 sits halfway at 0.385.
    expect(scrimAlphaAt("left", 0.86)).toBeCloseTo(0.385, 5);
  });

  it("clamps outside the band rather than extrapolating", () => {
    expect(scrimAlphaAt("left", -1)).toBeCloseTo(0.9, 5);
    expect(scrimAlphaAt("left", 2)).toBeCloseTo(0.15, 5);
  });

  it("keeps the centre variant symmetric", () => {
    // Asymmetry here is the defect the variant exists to avoid: a ramp under
    // centred copy lights one side of a headline and shadows the other.
    for (const x of [0, 0.1, 0.25, 0.4]) {
      expect(scrimAlphaAt("center", x)).toBeCloseTo(
        scrimAlphaAt("center", 1 - x),
        5,
      );
    }
  });

  it("holds one alpha across the flat variant", () => {
    for (const x of [0, 0.3, 0.7, 1]) {
      expect(scrimAlphaAt("flat", x)).toBeCloseTo(0.85, 5);
    }
  });
});

describe("scrim contracts", () => {
  it("keeps every text zone inside the band and non-empty", () => {
    for (const variant of VARIANTS) {
      const [start, end] = PHOTO_BAND_SCRIMS[variant].textZone;
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThanOrEqual(1);
      expect(end).toBeGreaterThan(start);
    }
  });

  it("orders stops left to right", () => {
    for (const variant of VARIANTS) {
      const offsets = PHOTO_BAND_SCRIMS[variant].stops.map((s) => s.offset);
      expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    }
  });

  it("never lets the text zone fall below the scrim floor", () => {
    // A SANITY RAIL, NOT THE CONTRAST CHECK. Whether copy is legible over a
    // given photograph is decided by `check-photo-band-contrast.ts` against
    // that photograph's pixels; this only catches a spec that could not work
    // over ANY plausible frame. 0.6 is where the homepage photograph's own
    // measurements put the cliff: a ramp reaching 0.60 at the edge of the copy
    // lands body text at 4.62:1, and 0.55 at 4.19:1, which fails outright.
    for (const variant of VARIANTS) {
      const [start, end] = PHOTO_BAND_SCRIMS[variant].textZone;
      for (let x = start; x <= end; x += 0.01) {
        expect(scrimAlphaAt(variant, x)).toBeGreaterThanOrEqual(0.6);
      }
    }
  });

  it("paints from the ground token rather than a literal colour", () => {
    for (const variant of VARIANTS) {
      const css = scrimBackgroundImage(variant);
      expect(css).toContain("var(--ground)");
      expect(css).not.toMatch(/#[0-9a-f]{3,8}/i);
      expect(css).not.toContain("rgba(");
    }
  });
});
