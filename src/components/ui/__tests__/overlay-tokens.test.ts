import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

const ROOT = path.resolve(__dirname, "../../../..");

const CSS = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
const UTILS = readFileSync(path.join(ROOT, "src/lib/utils/index.ts"), "utf8");

/**
 * The same shape `scripts/generate-design-tokens.mjs` uses: the `max-width`
 * must be the block's FIRST declaration. A pattern willing to scan forward
 * would bind some later rule's width to this name.
 */
const OVERLAY_DECLARATION =
  /@utility\s+(overlay-[a-z0-9-]+)\s*\{\s*max-width:\s*([^;]+);/gi;

function declaredOverlays(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, name, raw] of CSS.matchAll(OVERLAY_DECLARATION)) {
    out.set(name, raw.trim());
  }
  return out;
}

/** The `overlay-*` strings inside the `max-w` class group, comments excluded. */
function registeredOverlays(): Set<string> {
  const group = UTILS.match(/"max-w":\s*\[([\s\S]*?)\]/);
  if (!group) throw new Error("no `max-w` class group in src/lib/utils");
  const body = group[1].replace(/\/\/[^\n]*/g, "");
  return new Set(
    [...body.matchAll(/"(overlay-[a-z0-9-]+)"/g)].map((m) => m[1]),
  );
}

describe("overlay width tokens", () => {
  it("overlay-form is declared in globals.css", () => {
    expect(declaredOverlays().get("overlay-form")).toBe("32rem");
  });

  it("overlay names in globals.css and the tailwind-merge max-w group agree", () => {
    const declared = [...declaredOverlays().keys()].sort();
    const registered = [...registeredOverlays()].sort();

    // Non-empty, so a broken parser cannot pass this by matching nothing twice.
    expect(declared.length).toBeGreaterThan(0);
    expect(registered).toEqual(declared);
  });

  it("a call site can override an overlay width with another one", () => {
    // What registration buys: two `max-width` rules at equal specificity would
    // otherwise both survive, and the winner would be emission order.
    expect(cn("sm:overlay-form", "sm:overlay-panel")).toBe("sm:overlay-panel");
  });
});
