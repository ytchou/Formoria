// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const cssToken = (token: string) =>
  new RegExp(`--${token}:\\s*(#[0-9A-Fa-f]{6})`).exec(CSS)?.[1];

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
    expect(TEMPLATES.length).toBeGreaterThan(0);

    for (const name of TEMPLATES) {
      const html = readFileSync(join(TEMPLATE_DIR, name), "utf8");
      for (const hex of REJECTED) {
        expect(html, name).not.toMatch(new RegExp(hex, "i"));
      }
    }
  });

  it("uses the v2 accent from globals.css", () => {
    const accent = cssToken("accent");
    expect(accent).toBeTruthy();
    expect(THEME.palette.accent).toBe(accent);
    expect(THEME.colors.accent).toBe(accent);
    // `accentRules.color` is keyed BY hex, so a second accent with the same
    // value would be a duplicate JSON key. One accent, one key.
    expect(Object.keys(THEME.accentRules.color)).toEqual([accent]);
  });

  it("sits on the v2 ink ground with the v2 on-ink ramp", () => {
    expect(THEME.palette.dark).toBe(cssToken("ink"));
    expect(THEME.palette.cream).toBe(cssToken("ground"));
    expect(THEME.colors.background).toBe(cssToken("ink"));
    expect(THEME.colors.text).toBe(cssToken("on-ink"));
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
