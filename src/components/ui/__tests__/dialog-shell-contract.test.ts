import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import {
  balanced,
  collectSources,
  PRIMITIVE_DIR,
  stripComments,
} from "@/test/source-scan";

/**
 * THE OVERLAY SHELL OWNS ITS OWN BOX.
 *
 * `DialogContent`, `AlertDialogContent` and `SheetContent` now take a `size`
 * prop, and that prop is the only place width, height, scrolling and the
 * header/body/footer grid are decided. Before it, every overlay negotiated its
 * own box in `className`, which is how the same confirm dialog shipped at three
 * widths, how two sheets scrolled their whole shell instead of their body, and
 * how a `sm:max-w-lg` copied between files quietly became the house default
 * nobody had chosen.
 *
 * EVERY EXCLUSION IS LISTED IN `SHELL_BOX_EXCLUSIONS` WITH ITS OWN REASON, and
 * each one is a presentation the rule does not cover, not a file that was too
 * hard to migrate. The count is deliberately not written out here or in the
 * test names below: prose that counts rows drifts the moment a row is added,
 * and this docblock claimed "one" for as long as the list held two. Read the
 * list. Anything in it that does not fit the `size` axis is a new size, not a
 * call site wearing overrides.
 *
 * SCOPE: only what `size` actually owns.
 *   width    max-w-*      -> size
 *   height   max-h-*      -> size
 *   scroll   overflow-y-* -> size (the shell scrolls its body, never itself)
 *   grid     grid-rows-*  -> size
 * `p-*` and `gap-*` are deliberately absent: no axis owns overlay padding or
 * internal spacing, so forbidding them would mean inventing an axis to satisfy
 * a lint rule.
 *
 * This is NOT what `scripts/check-frontend-type-tokens.mjs` does. That gate
 * bans arbitrary-value utilities and leaves NAMED widths (`max-w-lg`,
 * `max-w-none`) alone on purpose, because they are legal Tailwind everywhere
 * else in the app. Named widths on an overlay shell are exactly the drift this
 * refactor removed, so they are caught here instead.
 *
 * Written as one regex literal rather than an array of class-name strings: a
 * repo-wide rename sweep treats an array of strings as data to update and has
 * previously inverted a guard's forbidden list. A regex literal resists that.
 *
 * The four names are alternated in ONE prefix group on purpose. Spelled out as
 * four separate arms, the source would contain the literal text of an arbitrary
 * width class, and `scripts/check-frontend-type-tokens.mjs` — which greps source
 * text, including this file — would report this guard's own pattern as an
 * unnamed page width. The alternation puts a `)` between the name and the
 * bracket, which breaks that substring without changing what is matched. Do not
 * "simplify" it back into four arms.
 */
const SHELL_OWNED_BOX =
  /(?<![\w-])(?:max-w|max-h|overflow-y|grid-rows)-[\w[\]().,%/+*-]+(?![\w-])/g;

/**
 * The exemptions, each with the reason it is not drift.
 *
 * Every entry is a path, and a path rots: rename or delete a file and the
 * filter silently stops excluding it, so the second test below asserts they are
 * all still present. Adding a row here is a design decision, not a way to get
 * a red test green.
 */
const SHELL_BOX_EXCLUSIONS: { path: string; reason: string }[] = [
  {
    // The one deliberate exemption from the mobile bottom-sheet rule. The expo
    // floor map is a fullscreen image viewer: on mobile it presents
    // `w-screen h-[100dvh]` edge to edge, because a map read at bottom-sheet
    // height is not readable at all. It therefore sets its own height and width
    // caps, and no `size` value should be invented to describe a one-off
    // fullscreen viewer.
    path: "src/components/events/taiwan-creative-expo-official-map.tsx",
    reason: "fullscreen map viewer — the deliberate bottom-sheet exemption",
  },
];

type Violation = { file: string; line: number; classes: string[] };

function findViolations(file: string): Violation[] {
  const src = readFileSync(file, "utf8");
  const out: Violation[] = [];

  const constructs: { idx: number; region: string }[] = [];
  for (const m of src.matchAll(/<(?:Dialog|AlertDialog|Sheet)Content\b/g)) {
    const region = balanced(src, m.index, "<", ">");
    if (region) constructs.push({ idx: m.index, region });
  }

  for (const c of constructs) {
    const region = stripComments(c.region);
    const hits = new Set<string>();

    // ONLY this construct's own className. Reading every string in the region
    // would pick up classNames on child JSX inside the opening tag.
    for (const m of region.matchAll(/\bclassName\s*[:=]/g)) {
      const rest = region.slice(m.index + m[0].length);
      const open = rest.match(/^\s*(\{|"|'|`)/);
      if (!open) continue;
      const raw =
        open[1] === "{"
          ? balanced(rest, rest.indexOf("{"), "{", "}")
          : rest.slice(rest.indexOf(open[1]));
      if (!raw) continue;
      const scoped =
        open[1] === "{" ? raw : raw.slice(0, raw.indexOf(open[1], 1) + 1);

      for (const q of scoped.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)) {
        const value = q[1] ?? q[2] ?? q[3] ?? "";
        for (const g of value.matchAll(SHELL_OWNED_BOX)) {
          // Anything behind an arbitrary-variant selector ending in `]:` is not
          // the shell's own box. `[&_[data-slot=body]]:overflow-y-auto` targets
          // a descendant; `data-[side=right]:max-w-none` on a SheetContent is
          // the side-conditional width the shell's `size` axis does not supply
          // (Wave 2: `overlay-wide` sets max-width only, never width), so those
          // rules are load-bearing and stay with the call site. `max-w-none`
          // is NOT waved through generally — only when it is bound to a
          // variant condition the shell cannot express.
          if (value.slice(0, g.index).endsWith("]:")) continue;
          hits.add(g[0]);
        }
      }
    }

    if (hits.size > 0) {
      out.push({
        file,
        line: src.slice(0, c.idx).split("\n").length,
        classes: [...hits].sort(),
      });
    }
  }
  return out;
}

describe("dialog shell contract", () => {
  it("no call site sets width, height, scroll or grid in a Content className", () => {
    const excluded = new Set(SHELL_BOX_EXCLUSIONS.map((e) => e.path));

    const offenders = collectSources("src")
      .filter((file) => !file.includes(PRIMITIVE_DIR))
      .filter((file) => !excluded.has(relative(process.cwd(), file)))
      .flatMap(findViolations)
      .map(
        (v) =>
          `${relative(process.cwd(), v.file)}:${v.line}  ${v.classes.join(" ")}`,
      );

    expect(offenders).toEqual([]);
  });

  /**
   * If an excluded file is renamed or deleted, the filter silently stops
   * excluding it and the hole grows by exactly one unexamined file. This makes
   * that rename fail loudly here instead. Named for the list rather than for a
   * number, so adding a row cannot make the name a lie.
   */
  it("every excluded path still exists", () => {
    const missing = SHELL_BOX_EXCLUSIONS.filter(
      (e) => !existsSync(join(process.cwd(), e.path)),
    ).map((e) => `${e.path} (${e.reason})`);

    expect(missing).toEqual([]);
  });
});
