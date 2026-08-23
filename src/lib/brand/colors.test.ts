// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { brand } from "./colors";

/**
 * SATORI CANNOT READ A CSS TOKEN, so `next/og` routes carry their own copy of
 * the palette. A second copy is exactly how v1's palette forked four ways, and
 * the only thing that keeps this one honest is that it is small, named for the
 * v2 roles, and asserted here against the values in `src/app/globals.css`.
 */
const V2 = {
  ground: "#FAF7F2",
  surface: "#F1EAE0",
  ink: "#1A1815",
  inkSoft: "#4A443C",
  inkMuted: "#6F685F",
  rule: "#DED5C8",
  accent: "#2F4F63",
} as const;

/** The five files that build a satori tree, plus the layout they share. */
const SATORI_FILES = [
  "src/app/opengraph-image.tsx",
  "src/app/[locale]/brands/[slug]/opengraph-image.tsx",
  "src/app/[locale]/og/trust/opengraph-image.tsx",
  "src/app/api/share-card/[slug]/route.tsx",
  "src/lib/growth/share-card.tsx",
  "src/lib/brand/og-layout.tsx",
];

describe("OG routes render on the v2 palette", () => {
  it("mirrors globals.css exactly", () => {
    expect(brand).toEqual(V2);
  });

  it("reads the same values globals.css declares", () => {
    const css = readFileSync(
      join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    const declared = (token: string) =>
      new RegExp(`--${token}:\\s*(#[0-9A-Fa-f]{6})`).exec(css)?.[1];

    expect(declared("ground")).toBe(brand.ground);
    expect(declared("surface")).toBe(brand.surface);
    expect(declared("ink")).toBe(brand.ink);
    expect(declared("ink-soft")).toBe(brand.inkSoft);
    expect(declared("ink-muted")).toBe(brand.inkMuted);
    expect(declared("rule")).toBe(brand.rule);
    expect(declared("accent")).toBe(brand.accent);
  });

  it("keeps every hex in colors.ts — no satori file writes one inline", () => {
    const offenders: string[] = [];

    for (const file of SATORI_FILES) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      for (const [hex] of source.matchAll(/#[0-9A-Fa-f]{3,8}\b/g)) {
        offenders.push(`${file}: ${hex}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("names no serif or 明體 face — D17 makes these sans-only", () => {
    for (const file of SATORI_FILES) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source.replaceAll("sans-serif", ""), file).not.toMatch(
        /serif|font-ming|明體|Noto Serif/i,
      );
    }
  });

  it("retires the v1 key names that outlived their values", () => {
    // `cta` held the accent, `espresso` held a grey, `primary` was a duplicate
    // of `fg`, and `bg` was a paper white the palette no longer ships. Four
    // names that each described a value that had already moved.
    for (const dead of ["cta", "espresso", "primary", "fg", "bg"]) {
      expect(Object.keys(brand)).not.toContain(dead);
    }
  });
});

/**
 * THE OTHER TWO COPIES.
 *
 * `brand` above is the copy Satori needs, and it was the only one pinned. Two
 * more exist because they render outside the Next app entirely: email clients
 * strip <style>, and the marketing cards are standalone HTML with no build
 * step. Neither can read a CSS custom property, so both hold hex literals.
 *
 * Three copies of a palette is how v1 forked four ways. The copies are not the
 * problem — being unable to notice when one drifts is. These bind the other two
 * to `globals.css` the same way the block above binds the first.
 */
describe("every hard-coded copy of the palette matches globals.css", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const declared = (token: string) =>
    new RegExp(`--${token}:\\s*(#[0-9A-Fa-f]{6})`).exec(css)?.[1];

  it("emails/styles.ts", () => {
    const emails = readFileSync(join(process.cwd(), "emails/styles.ts"), "utf8");
    const exported = (name: string) =>
      new RegExp(`export const ${name} = '(#[0-9A-Fa-f]{6})'`).exec(emails)?.[1];

    // ON_ACCENT is text ON the accent fill, which v2 paints in `ground`.
    expect({
      GROUND: exported("GROUND"),
      SURFACE: exported("SURFACE"),
      INK: exported("INK"),
      INK_SOFT: exported("INK_SOFT"),
      INK_MUTED: exported("INK_MUTED"),
      RULE: exported("RULE"),
      ACCENT: exported("ACCENT"),
      ON_ACCENT: exported("ON_ACCENT"),
    }).toEqual({
      GROUND: declared("ground"),
      SURFACE: declared("surface"),
      INK: declared("ink"),
      INK_SOFT: declared("ink-soft"),
      INK_MUTED: declared("ink-muted"),
      RULE: declared("rule"),
      ACCENT: declared("accent"),
      ON_ACCENT: declared("ground"),
    });
  });

  it("marketing/cards/theme.json", () => {
    const theme = JSON.parse(
      readFileSync(join(process.cwd(), "marketing/cards/theme.json"), "utf8"),
    ) as { palette: Record<string, string> };

    // The cards render on an INK ground, so they use the inverse ramp.
    expect({
      accent: theme.palette.accent,
      dark: theme.palette.dark,
      cream: theme.palette.cream,
      onInk: theme.palette.onInk,
      onInkMuted: theme.palette.onInkMuted,
      ruleOnInk: theme.palette.ruleOnInk,
    }).toEqual({
      accent: declared("accent"),
      dark: declared("ink"),
      cream: declared("ground"),
      onInk: declared("on-ink"),
      onInkMuted: declared("on-ink-muted"),
      ruleOnInk: declared("rule-on-ink"),
    });
  });
});
