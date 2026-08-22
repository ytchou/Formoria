import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Shared machinery for the source gates that enforce a rule across a whole
 * SURFACE rather than inside one component.
 *
 * Some design rules are properties of a screen, not of a file: "the dashboard
 * reads as a tool", "admin never fills with the accent". A class assertion on
 * each component cannot express those, because the file that breaks the rule
 * next month does not exist yet and no per-file test will ever open it. A
 * directory scan does, which is the same shape the repo already uses for the
 * hardcoded-CJK guard and the frontend token guard.
 *
 * No Han characters anywhere in this file, on purpose: it is a plain `.ts`
 * under `src/`, so `no-hardcoded-cjk.test.ts` scans it. The two typefaces are
 * spelled Ming (serif, content) and Hei (sans, interface) throughout.
 */

/** Every non-test `.ts`/`.tsx` under `root`, sorted, with `__tests__` skipped. */
export function collectSources(root: string): string[] {
  const files: string[] = [];
  const stack = [join(process.cwd(), root)];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const child = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "node_modules") continue;
        stack.push(child);
        continue;
      }
      if (
        entry.isFile() &&
        /\.tsx?$/.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name)
      ) {
        files.push(child);
      }
    }
  }

  return files.sort();
}

export type HeadingMatch = {
  /** Repo-relative path. */
  file: string;
  /** 1-based line of the opening tag. */
  line: number;
  /** Everything between `<h1` and the closing `>` of the opening tag. */
  attributes: string;
};

/**
 * Every `<h1>`...`<h6>` opening tag in `files`.
 *
 * Deliberately syntactic rather than type-aware: a heading rendered through a
 * component that takes `variant="cardTitle"` is invisible here, and that is a
 * known hole rather than an oversight — the roles such a variant can resolve to
 * are already constrained by `textStyles`, which is where that case is
 * governed.
 */
export function collectHeadings(files: string[]): HeadingMatch[] {
  const headings: HeadingMatch[] = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");

    for (const match of source.matchAll(/<h[1-6](?=[\s/>])/g)) {
      const start = match.index + match[0].length;
      let depth = 0;
      let end = source.length;

      for (let i = start; i < source.length; i += 1) {
        const char = source[i];
        if (char === "{") depth += 1;
        else if (char === "}") depth -= 1;
        else if (char === ">" && depth === 0) {
          end = i;
          break;
        }
      }

      headings.push({
        file: relative(process.cwd(), file),
        line: source.slice(0, match.index).split("\n").length,
        attributes: source.slice(start, end),
      });
    }
  }

  return headings;
}

/**
 * The four Ming roles that carry a TITLE. `type-body` and `type-body-sm` are
 * Ming too and are deliberately absent: they carry sentences, and a sentence is
 * content on any screen. Only titles invert on a tool surface.
 */
const MING_TITLE_ROLES = [
  "type-display",
  "type-page-title",
  "type-section",
  "type-card-title",
] as const;

/** The Ming title role used in `attributes`, if any. */
export function mingTitleRoleIn(attributes: string): string | undefined {
  return MING_TITLE_ROLES.find((role) =>
    new RegExp(`\\b${role}\\b`).test(attributes),
  );
}
