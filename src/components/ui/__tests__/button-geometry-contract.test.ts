import { readFileSync } from "node:fs";
import { relative } from "node:path";

import { describe, expect, it } from "vitest";

import { collectSources } from "@/test/source-scan";

/**
 * THE BUTTON OWNS ITS OWN GEOMETRY.
 *
 * `button.tsx` has four axes — variant, shape, size, width. Before this gate,
 * 92 of 218 call sites reached past them and set geometry in `className`
 * instead, which is why one `secondary` button rendered at 44px, 48px and 36px
 * on a single page, and why `min-h-12` beat `size="compact"` at nine sites
 * where the two flatly contradicted each other.
 *
 * THERE IS NO ALLOWLIST, and that is the point. A control that cannot be
 * expressed through the axes is not a `Button` wearing overrides — it is a
 * different component, and the repo now has the ones that were hiding as
 * exceptions: `UnstyledButton` (Base UI `render` props), `OptionRow`,
 * `UploadDropzone`, `ShareChannelButton`. Reach for one of
 * those, or add an axis. Do not add a name to a list here.
 *
 * SCOPE: only what an axis actually owns.
 *   height   h-* / min-h-*        -> size
 *   width    w-full               -> width
 *   radius   rounded-*            -> shape
 *   box      size-*               -> size="icon"
 * `px-*`, `gap-*`, `min-w-*`, `w-fit` and responsive `sm:w-auto` are NOT
 * listed: no axis owns them, so forbidding them would mean inventing axes to
 * satisfy a lint rule. That is the opposite of the point.
 */
const AXIS_OWNED_GEOMETRY =
  /(?<![\w-])(?:min-)?h-(?:\d+(?:\.\d+)?|px|full|auto|screen|fit)(?![\w-])|(?<![\w-])w-full(?![\w-])|(?<![\w-])size-\d+(?:\.\d+)?(?![\w-])|(?<![\w-])rounded(?:-[\w[\]().%-]+)?(?![\w-])/g;

/**
 * `src/components/ui/**` is where the primitives themselves live — the button,
 * and the components that legitimately are not buttons. This is a structural
 * boundary, the same one `eslint.config.mjs` draws, not a per-file permission.
 */
const PRIMITIVE_DIR = "src/components/ui/";

/** Blank out comments, preserving offsets — a prose comment naming a class
 *  ("replaces a `size-8` override") otherwise parses as a template literal and
 *  gets reported as the very violation it describes. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

/** Capture a balanced region starting at `i`, counting `open`/`close`. */
function balanced(src: string, i: number, open: string, close: string): string | null {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === open) depth++;
    else if (src[j] === close) {
      depth--;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  return null;
}

type Violation = { file: string; line: number; classes: string[] };

function findViolations(file: string): Violation[] {
  const src = readFileSync(file, "utf8");
  const out: Violation[] = [];

  const constructs: { idx: number; region: string }[] = [];
  for (const m of src.matchAll(/<(?:Button|SubmitButton)\b/g)) {
    const region = balanced(src, m.index, "<", ">");
    if (region) constructs.push({ idx: m.index, region });
  }
  for (const m of src.matchAll(/buttonVariants\s*\(/g)) {
    const region = balanced(src, src.indexOf("(", m.index), "(", ")");
    if (region) constructs.push({ idx: m.index, region });
  }

  for (const c of constructs) {
    const region = stripComments(c.region);
    const hits = new Set<string>();

    // ONLY this construct's own className. Reading every string in the region
    // caught icon classNames on child JSX in the opening tag.
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
        for (const g of value.matchAll(AXIS_OWNED_GEOMETRY)) {
          // `[&_svg]:size-4` sizes the ICON, not the control. Any arbitrary
          // variant selector ending in `]:` targets a descendant.
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

describe("button geometry contract", () => {
  it("no call site sets height, width, radius or box size in a Button className", () => {
    const offenders = collectSources("src")
      .filter((file) => !file.includes(PRIMITIVE_DIR))
      .flatMap(findViolations)
      .map((v) => `${relative(process.cwd(), v.file)}:${v.line}  ${v.classes.join(" ")}`);

    expect(offenders).toEqual([]);
  });

  /**
   * The hole that let three identical call-to-action buttons accumulate.
   *
   * `eslint.config.mjs`'s `no-restricted-syntax` matches AST shape, not string
   * contents, so it can forbid a styled raw `<button>` but is blind to an
   * `<a>` wearing a hand-copied button class string. This closes that.
   */
  it("no link is styled as a button without going through buttonVariants", () => {
    const offenders: string[] = [];

    for (const file of collectSources("src")) {
      if (file.includes(PRIMITIVE_DIR)) continue;
      const src = readFileSync(file, "utf8");
      if (src.includes("buttonVariants")) continue;

      for (const m of stripComments(src).matchAll(/<(?:a|Link)\s/g)) {
        const region = balanced(src, m.index, "<", ">");
        if (!region) continue;
        // A link that walks like a button: laid out as a control, with a
        // radius, and painted with a fill or a border.
        const looksLikeAButton =
          /inline-flex|\bflex\b/.test(region) &&
          /rounded-/.test(region) &&
          /\bbg-|\bborder\b|\bborder-/.test(region);
        if (looksLikeAButton) {
          offenders.push(
            `${relative(process.cwd(), file)}:${src.slice(0, m.index).split("\n").length}`,
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
