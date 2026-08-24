import { readFileSync } from "node:fs";
import { relative } from "node:path";

import { describe, expect, it } from "vitest";

import { collectSources } from "@/test/source-scan";

/**
 * A CHIP IS 36px, AND THE ROW IS THE OTHER HALF OF THAT EXCEPTION.
 *
 * Every other control is 44px. A chip is 36px, which only clears the touch
 * target while its neighbours sit at least 14px away — so the clear space is
 * not styling, it is the reason the exception is allowed at all.
 *
 * That contract used to live on the chip, as `m-[7px]` on all four sides. It
 * was un-cancellable except by a caller writing a matching negative margin, so
 * 8 of 9 rows kept their own `flex flex-wrap gap-2` on top of it: `gap`
 * measures between margin boxes, so the real gap was 22px and every row sat
 * 7px right of the heading above it. The one row that DID cancel it lost its
 * `mt-3` to tailwind-merge instead.
 *
 * The gap lives on `ChipRow` now, which cannot be double-counted — and this
 * file is what stops it drifting back. A hand-rolled `<div className="flex
 * flex-wrap gap-2">` around chips is invisible to every unit test that renders
 * one chip at a time; only a scan of the whole surface sees it.
 */
const CHIP_ROOTS = ["src/components", "src/app"];

/**
 * Chips that legitimately stand alone. A single chip has no neighbour to steal
 * its tap, so it needs no row — but "this one is fine" has to be written down
 * rather than assumed, and the count has to be exact so a second chip added
 * beside it trips this test.
 */
const LONE_CHIPS: Record<string, { allowed: number; why: string }> = {};

/** Ancestors that are structure, not layout — they never own a gap. */
const TRANSPARENT_ANCESTORS = new Set(["li", "", "Fragment", "React.Fragment"]);

/**
 * JSX and block comments, blanked so a commented-out tag cannot move the stack.
 * Newlines survive: the reported line number has to match the real file, and a
 * scanner that points at the wrong line is worse than no scanner.
 */
function stripComments(source: string): string {
  const blank = (match: string) => match.replace(/[^\n]/g, " ");

  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (_match, lead: string) => lead);
}

type Tag = {
  name: string;
  /** Everything between the tag name and the closing `>`. */
  body: string;
  selfClosing: boolean;
  /** 1-based line of the opening `<`. */
  line: number;
};

/** The opening tag starting at `from`, brace-aware so `{…}` props cannot end it. */
function readOpeningTag(source: string, from: number): { tag: Tag; end: number } {
  const nameMatch = /^<([A-Za-z][\w.]*)/.exec(source.slice(from));
  const name = nameMatch?.[1] ?? "";
  let depth = 0;
  let quote: string | null = null;

  for (let i = from + 1 + name.length; i < source.length; i += 1) {
    const char = source[i];

    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0) {
      const body = source.slice(from + 1 + name.length, i);
      return {
        tag: {
          name,
          body,
          selfClosing: body.trimEnd().endsWith("/"),
          line: source.slice(0, from).split("\n").length,
        },
        end: i,
      };
    }
  }

  return {
    tag: { name, body: "", selfClosing: true, line: 1 },
    end: source.length,
  };
}

type Offence = { file: string; line: number; ancestor: string };

/** Every chip in `source` whose nearest layout ancestor is not a `ChipRow`. */
function chipsOutsideARow(file: string, rawSource: string): Offence[] {
  const source = stripComments(rawSource);
  const stack: string[] = [];
  const offences: Offence[] = [];

  for (let i = 0; i < source.length; i += 1) {
    if (source[i] !== "<") continue;

    if (source[i + 1] === "/") {
      const close = /^<\/([A-Za-z][\w.]*)?\s*>/.exec(source.slice(i));
      if (close) {
        stack.pop();
        i += close[0].length - 1;
      }
      continue;
    }
    if (source[i + 1] === ">") {
      // A fragment: `<>`.
      stack.push("");
      i += 1;
      continue;
    }
    if (!/[A-Za-z]/.test(source[i + 1] ?? "")) continue;

    const { tag, end } = readOpeningTag(source, i);
    const isChip =
      tag.name === "ToggleChip" || /\btaxonomyLinkClasses\s*\(/.test(tag.body);

    if (isChip) {
      const ancestor =
        [...stack].reverse().find((name) => !TRANSPARENT_ANCESTORS.has(name)) ??
        "(none)";
      if (ancestor !== "ChipRow") {
        offences.push({ file, line: tag.line, ancestor });
      }
    }

    if (!tag.selfClosing) stack.push(tag.name);
    i = end;
  }

  return offences;
}

const sources = CHIP_ROOTS.flatMap(collectSources);

describe("the chip row contract", () => {
  it("renders every chip inside a ChipRow, or names the exception", () => {
    const byFile = new Map<string, Offence[]>();

    for (const path of sources) {
      const source = readFileSync(path, "utf-8");
      if (!/<ToggleChip|taxonomyLinkClasses\s*\(/.test(source)) continue;

      const file = relative(process.cwd(), path);
      const offences = chipsOutsideARow(file, source);
      if (offences.length > 0) byFile.set(file, offences);
    }

    const unexplained = [...byFile.entries()].flatMap(([file, offences]) => {
      const allowed = LONE_CHIPS[file]?.allowed ?? 0;
      return offences.slice(allowed).map(
        ({ line, ancestor }) =>
          `${file}:${line} — chip's nearest layout ancestor is <${ancestor}>, not <ChipRow>. ` +
          `Wrap the row in <ChipRow> (it owns the 14px gap the 36px chip needs), ` +
          `or add the file to LONE_CHIPS with a reason if the chip truly stands alone.`,
      );
    });

    expect(unexplained).toEqual([]);
  });

  it("still finds the rows it is meant to be watching", () => {
    // A scanner that silently matches nothing is a green test that guards
    // nothing. Pin the surface it actually covers.
    const chipFiles = sources.filter((path) =>
      /<ToggleChip|taxonomyLinkClasses\s*\(/.test(readFileSync(path, "utf-8")),
    );

    expect(chipFiles.length).toBeGreaterThanOrEqual(9);
  });

  it("has no stale LONE_CHIPS entry", () => {
    for (const file of Object.keys(LONE_CHIPS)) {
      const source = readFileSync(file, "utf-8");
      expect(chipsOutsideARow(file, source).length).toBeGreaterThan(0);
    }
  });
});
