// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ENFORCEMENT REPORTS NOTHING ON THE MICROSITE, WHICH IS WHY THIS FILE EXISTS.
 *
 * `src/components/microsite/**` is exempt from the eslint ui-primitive rule and
 * carries five live escapes in `scripts/check-frontend-type-tokens.mjs`. The
 * route is also `noindex`, so it is invisible to every search-based smoke check
 * and nobody would notice it drifting. Thirteen files were audited by hand for
 * DEV-1514; this test is what keeps the audit from having to be repeated by
 * hand next time.
 *
 * It deliberately does NOT touch the per-brand accent — see the sibling
 * assertion in `registry.test.ts`. Those values are brand property and sit
 * outside the system palette by design (DESIGN.md §2, the one documented
 * exception).
 */

const ROOTS = [
  join(process.cwd(), "src/app/(microsite)"),
  join(process.cwd(), "src/components/microsite"),
];

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of readdirSync(current)) {
      const child = join(current, entry);
      if (statSync(child).isDirectory()) {
        if (entry !== "__tests__") stack.push(child);
        continue;
      }
      if (/\.tsx?$/.test(entry)) out.push(child);
    }
  }

  return out.sort();
}

const FILES = ROOTS.flatMap(sourceFiles);

function read(file: string): string {
  return readFileSync(file, "utf8");
}

function relative(file: string): string {
  return file.slice(process.cwd().length + 1);
}

describe("microsite renders on design system v2", () => {
  it("covers the whole surface — 14 files, the 2 test files excluded", () => {
    // 12 after `microsite-cta.tsx` was extracted from the three hand-written
    // copies of the CTA class string in hero / contact-cta / product-grid.
    expect(FILES).toHaveLength(12);
  });

  it("carries no v1 colour token", () => {
    // Every one of these still resolves in globals.css, so nothing here fails
    // to compile, fails a lint or renders wrong. It just renders v1.
    const legacy =
      /\b(?:bg|text|border|ring|divide|outline)-(?:background|foreground|card|secondary|muted|border|primary|cta)\b/;

    for (const file of FILES) {
      expect(read(file), relative(file)).not.toMatch(legacy);
    }
  });

  it("has no dark-mode branch and no shadow — elevation is the rule", () => {
    for (const file of FILES) {
      expect(read(file), relative(file)).not.toMatch(/\bdark:/);
      expect(read(file), relative(file)).not.toMatch(/\bshadow-(?!none)/);
    }
  });

  it("uses the v2 radius scale — 4px on controls, 2-3px on surfaces", () => {
    // `rounded-full` stays: chips and pills are the stated exception.
    for (const file of FILES) {
      expect(read(file), relative(file)).not.toMatch(
        /\brounded(?:-[trbl]{1,2})?-(?:sm|md|lg|xl|2xl|3xl|4xl)\b/,
      );
    }
  });

  it("draws a focus indicator on every interactive element", () => {
    // `:focus-visible` with a drawn 2px accent ring is the accessibility floor.
    // Anchors on this surface are the brand's only calls to action.
    for (const file of FILES) {
      const source = read(file);
      if (!/<a[\s>]/.test(source)) continue;
      expect(source, relative(file)).toContain("focus-visible:");
    }
  });
});

describe("microsite is noindex", () => {
  const layout = read(join(process.cwd(), "src/app/(microsite)/layout.tsx"));
  const helpers = read(
    join(process.cwd(), "src/app/(microsite)/site/[slug]/microsite-helpers.ts"),
  );

  it("declares robots index:false on the layout", () => {
    // Asserted on the source rather than by importing the module: the layout
    // imports `globals.css`, and a Tailwind 4 stylesheet is not something a
    // node-environment unit test should be made to parse.
    expect(layout).toMatch(/robots:\s*\{\s*index:\s*false/);
  });

  it("declares it again on the page metadata, so a layout edit cannot lift it", () => {
    expect(helpers).toMatch(/robots:\s*\{\s*index:\s*false/);
  });
});
