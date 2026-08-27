import { describe, expect, it } from "vitest";

import {
  BREAKPOINT_PX,
  PHOTO_BAND_SCRIMS,
  scrimAlphaAt,
  scrimBackgroundImage,
  scrimBreakpoints,
  scrimClassName,
  scrimStyleRules,
  type ScrimVariant,
} from "@/lib/design/photo-band-scrims";

const VARIANTS = Object.keys(PHOTO_BAND_SCRIMS) as ScrimVariant[];

const ALL_BREAKPOINTS = VARIANTS.flatMap((variant) =>
  scrimBreakpoints(variant).map((breakpoint) => ({ variant, breakpoint })),
);

/**
 * The interpolation is the seam between what the browser paints and what
 * `scripts/check-photo-band-contrast.ts` measures. If it drifts, the gate keeps
 * passing while the page gets darker — the exact failure mode the gate exists
 * to remove — so the arithmetic is pinned here rather than trusted.
 */
describe("scrimAlphaAt", () => {
  it("returns the stop's own alpha at each stop", () => {
    for (const { breakpoint } of ALL_BREAKPOINTS) {
      for (const stop of breakpoint.stops) {
        expect(scrimAlphaAt(breakpoint, stop.offset)).toBeCloseTo(
          stop.alpha,
          5,
        );
      }
    }
  });

  it("interpolates linearly between stops", () => {
    const wide = scrimBreakpoints("left")[1]!;
    // `left` wide runs 0.90 at x=0 to 0.85 at x=0.50, so the midpoint is 0.875.
    expect(scrimAlphaAt(wide, 0.25)).toBeCloseTo(0.875, 5);
    // and 0.62 to 0.15 across the last 28%, so 0.86 sits halfway at 0.385.
    expect(scrimAlphaAt(wide, 0.86)).toBeCloseTo(0.385, 5);
  });

  it("clamps outside the band rather than extrapolating", () => {
    const wide = scrimBreakpoints("left")[1]!;
    expect(scrimAlphaAt(wide, -1)).toBeCloseTo(0.9, 5);
    expect(scrimAlphaAt(wide, 2)).toBeCloseTo(0.15, 5);
  });

  it("keeps the centre variant symmetric at every breakpoint", () => {
    // Asymmetry here is the defect the variant exists to avoid: a ramp under
    // centred copy lights one side of a headline and shadows the other.
    for (const breakpoint of scrimBreakpoints("center")) {
      for (const x of [0, 0.1, 0.25, 0.4]) {
        expect(scrimAlphaAt(breakpoint, x)).toBeCloseTo(
          scrimAlphaAt(breakpoint, 1 - x),
          5,
        );
      }
    }
  });

  it("holds one alpha across the flat variant", () => {
    for (const breakpoint of scrimBreakpoints("flat")) {
      for (const x of [0, 0.3, 0.7, 1]) {
        expect(scrimAlphaAt(breakpoint, x)).toBeCloseTo(0.85, 5);
      }
    }
  });

  it("paints the dark variant uniformly from surface-dark", () => {
    for (const breakpoint of scrimBreakpoints("dark")) {
      for (const x of [0, 0.3, 0.7, 1]) {
        expect(scrimAlphaAt(breakpoint, x)).toBeCloseTo(0.8, 5);
      }
      expect(scrimBackgroundImage(breakpoint)).toContain("var(--surface-dark)");
    }
  });
});

describe("scrim contracts", () => {
  it("declares a base breakpoint and orders the rest ascending", () => {
    // A variant whose first entry is not the base would paint nothing under
    // its own media query — a band with no scrim at all on a phone.
    for (const variant of VARIANTS) {
      const widths = scrimBreakpoints(variant).map((b) => b.minWidth);
      expect(widths[0]).toBe(0);
      expect(widths).toEqual([...widths].sort((a, b) => a - b));
      expect(new Set(widths).size).toBe(widths.length);
    }
  });

  it("protects the viewport-capped copy at the narrow breakpoint", () => {
    // THE DEFECT THIS BREAKPOINT EXISTS FOR. Under 1123px the copy is capped
    // by the viewport, not by its 48rem reading measure, so it runs to x=0.94
    // — past the wide zone's 0.72, over a scrim that has already fallen to
    // 0.25. Every variant's base entry must therefore cover the copy out to at
    // least 0.94 of the band.
    for (const variant of VARIANTS) {
      const base = scrimBreakpoints(variant)[0]!;
      expect(base.textZone[1]).toBeGreaterThanOrEqual(0.94);
    }
  });

  it("keeps every text zone inside the band and non-empty", () => {
    for (const { breakpoint } of ALL_BREAKPOINTS) {
      const [start, end] = breakpoint.textZone;
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThanOrEqual(1);
      expect(end).toBeGreaterThan(start);
    }
  });

  it("orders stops left to right", () => {
    for (const { breakpoint } of ALL_BREAKPOINTS) {
      const offsets = breakpoint.stops.map((s) => s.offset);
      expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    }
  });

  it("states a band aspect ratio for every breakpoint", () => {
    // `object-cover` crops against this, so the gate cannot know which pixels
    // render without it. A breakpoint missing one would be measured against
    // the whole file — the defect the crop model replaced.
    for (const { breakpoint } of ALL_BREAKPOINTS) {
      expect(breakpoint.bandAspect).toBeGreaterThan(0);
    }
  });

  it("never lets the text zone fall below the scrim floor", () => {
    // A SANITY RAIL, NOT THE CONTRAST CHECK. Whether copy is legible over a
    // given photograph is decided by `check-photo-band-contrast.ts` against
    // that photograph's pixels; this only catches a spec that could not work
    // over ANY plausible frame. 0.6 is where the homepage photograph's own
    // measurements put the cliff: a ramp reaching 0.60 at the edge of the copy
    // lands body text at 4.62:1, and 0.55 at 4.19:1, which fails outright.
    //
    // INTEGER STEPS, AND BOTH ENDPOINTS ASSERTED. `x += 0.01` from 0
    // accumulated to 0.7100000000000004 and then overshot `<= 0.72`, so the
    // binding value — the alpha at the documented edge of the copy — was the
    // one value never tested: dropping the 0.72 stop from 0.62 to 0.59 left
    // this rail green.
    const STEPS = 100;
    for (const { variant, breakpoint } of ALL_BREAKPOINTS) {
      const [start, end] = breakpoint.textZone;
      const where = `${variant} @ ${breakpoint.minWidth}`;

      expect(
        scrimAlphaAt(breakpoint, start),
        `${where} start`,
      ).toBeGreaterThanOrEqual(0.6);
      expect(
        scrimAlphaAt(breakpoint, end),
        `${where} end`,
      ).toBeGreaterThanOrEqual(0.6);

      for (let step = 0; step <= STEPS; step += 1) {
        const x = start + ((end - start) * step) / STEPS;
        expect(
          scrimAlphaAt(breakpoint, x),
          `${where} @ ${x}`,
        ).toBeGreaterThanOrEqual(0.6);
      }
    }
  });

  it("paints from each variant's declared semantic token", () => {
    for (const { variant, breakpoint } of ALL_BREAKPOINTS) {
      const css = scrimBackgroundImage(breakpoint);
      expect(css).toContain(
        variant === "dark" ? "var(--surface-dark)" : "var(--ground)",
      );
      expect(css).not.toMatch(/#[0-9a-f]{3,8}/i);
      expect(css).not.toContain("rgba(");
    }
  });

  it("keeps enough precision to paint what the gate composites", () => {
    // `toFixed(1)` would have rounded a 0.6249 stop to 62.5% in the browser
    // while the gate measured 0.6249 — silent drift in the one direction this
    // module promises is impossible.
    const css = scrimBackgroundImage({
      colorToken: "--ground",
      minWidth: 0,
      textZone: [0, 1],
      bandAspect: 1,
      stops: [
        { offset: 0, alpha: 0.6249 },
        { offset: 0.3333, alpha: 0.5 },
      ],
    });

    expect(css).toContain("62.4900%");
    expect(css).toContain("33.3300%");
  });
});

describe("scrimStyleRules", () => {
  it("emits a base rule plus one media query per further breakpoint", () => {
    const css = scrimStyleRules("left");
    const selector = `.${scrimClassName("left")}`;

    expect(css.startsWith(`${selector}{background-image:`)).toBe(true);
    expect(css).toContain(`@media (min-width:${BREAKPOINT_PX}px){${selector}{`);
    expect(css.match(/@media/g)).toHaveLength(
      scrimBreakpoints("left").length - 1,
    );
  });

  it("emits nothing React would escape inside a <style> element", () => {
    // `<style>` is raw text to the browser, so a `>` React escaped to `&gt;`
    // on the way out would break the rule and leave the band with no scrim.
    // The generator asserts this too; this pins it from outside.
    for (const variant of VARIANTS) {
      expect(scrimStyleRules(variant)).not.toMatch(/[<>&]/);
    }
  });

  it("names one stable class per variant", () => {
    for (const variant of VARIANTS) {
      expect(scrimClassName(variant)).toBe(`photo-band-scrim-${variant}`);
    }
  });
});
