// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `marketing/` HAS NO OTHER SAFETY NET.
 *
 * Nothing in `src/` imports these files, no CI check reads them, and the cards
 * they render publish straight to social — the one surface in the design
 * system v2 rebuild where a regression is invisible until someone sees it in a
 * feed. Tweakable Decision 2 declined a fixture harness that renders and
 * diffs the cards; this is the cheap half that still catches the failure that
 * actually happened, which is a retired colour surviving a palette change.
 *
 * D17 applies here too: the cards are rendered by a headless browser but they
 * are a sans-only surface by design, matching emails and the `next/og` routes.
 */

type CardTheme = {
  palette: Record<string, string>;
  colors: Record<string, string>;
  typography: Record<string, string> & { scale: Record<string, unknown> };
  accentRules: { color: Record<string, unknown> } & Record<string, unknown>;
};

const CARDS = join(process.cwd(), "marketing/cards");
const THEME = JSON.parse(
  readFileSync(join(CARDS, "theme.json"), "utf8"),
) as CardTheme;

const TEMPLATE_DIR = join(CARDS, "templates");
const TEMPLATES = readdirSync(TEMPLATE_DIR).filter((name) =>
  name.endsWith(".html"),
);

/** Retired in design system v2: kiln and the two accents that shared its row. */
const REJECTED = ["2F5D50", "C4693B", "C04A24"];

describe("marketing theme carries no rejected colour", () => {
  it("names none of the retired accents", () => {
    const serialised = JSON.stringify(THEME);
    for (const hex of REJECTED) {
      expect(serialised).not.toMatch(new RegExp(hex, "i"));
    }
  });

  it("carries none of the retired accents in any card template", () => {
    expect(TEMPLATES).toHaveLength(4);

    for (const name of TEMPLATES) {
      const html = readFileSync(join(TEMPLATE_DIR, name), "utf8");
      for (const hex of REJECTED) {
        expect(html, name).not.toMatch(new RegExp(hex, "i"));
      }
    }
  });

  it("uses the one v2 accent", () => {
    expect(THEME.palette.accent).toBe("#2F4F63");
    expect(THEME.colors.accent).toBe("#2F4F63");
    // `accentRules.color` is keyed BY hex, so a second accent with the same
    // value would be a duplicate JSON key. One accent, one key.
    expect(Object.keys(THEME.accentRules.color)).toEqual(["#2F4F63"]);
  });

  it("sits on the v2 ink ground with the v2 on-ink ramp", () => {
    expect(THEME.palette.dark).toBe("#1A1815");
    expect(THEME.palette.cream).toBe("#FAF7F2");
    expect(THEME.colors.background).toBe("#1A1815");
    expect(THEME.colors.text).toBe("#D6CFC4");
  });
});

describe("marketing cards are a sans-only surface (D17)", () => {
  it("declares no serif family in the type tokens", () => {
    for (const key of ["fontHeading", "fontBody", "zhFallback"]) {
      const stack = String(THEME.typography[key]).replaceAll("sans-serif", "");
      expect(stack, key).not.toMatch(/serif/i);
      expect(stack, key).not.toMatch(/明體|宋體|Ming|Song|Noto Serif/i);
    }
  });

  it("loads no serif webfont in any card template", () => {
    for (const name of TEMPLATES) {
      const html = readFileSync(join(TEMPLATE_DIR, name), "utf8");
      expect(html, name).not.toMatch(/Noto\+Serif|Noto Serif/i);
      expect(html.replaceAll("sans-serif", ""), name).not.toMatch(/serif/i);
    }
  });
});
