// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE STOCK SHADCN PALETTE MUST STAY DELETED (DEV-1566).
 *
 * PR #869 removed every stock token from `globals.css` after migrating their
 * usages to Ink & Paper. `components.json` still declares
 * `baseColor: "neutral"`, so the next `npx shadcn add <component>` writes the
 * component AND re-adds the tokens it expects. Nothing else notices: the
 * tokens resolve, the component renders plausibly on the wrong palette, and
 * `pnpm check:design-tokens` only asserts that the v2 tokens are PRESENT.
 *
 * This is the inverse contract. A regex literal rather than an array of
 * names, so a find-and-replace sweep cannot silently rewrite the forbidden
 * list into an allowed one.
 *
 * Deliberately NOT forbidden: `--accent` / `--accent-foreground` (Ink & Paper
 * reuses the name) and `--chart-*` (kept for the admin dashboards).
 */
const STOCK_TOKEN_DECLARATION =
  /^\s*--(?:color-)?(?:background|foreground|card|card-foreground|popover|popover-foreground|primary|primary-foreground|secondary|secondary-foreground|muted|muted-foreground|destructive|destructive-foreground|border|input|ring|sidebar(?:-[a-z-]+)?|radius(?:-(?:sm|md|lg|xl|2xl|3xl|4xl))?)\s*:/gm;

describe("globals.css carries no stock shadcn tokens", () => {
  it("declares none of the palette deleted in PR #869", () => {
    const css = readFileSync(
      join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    const offenders = [...css.matchAll(STOCK_TOKEN_DECLARATION)].map((m) =>
      m[0].trim(),
    );
    expect(offenders).toEqual([]);
  });
});
