import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

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
        if (entry.name === "__tests__" || entry.name === "node_modules")
          continue;
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

/**
 * `src/components/ui/**` is where the primitives themselves live, so it is
 * where the classes these gates forbid at a call site are supposed to be
 * written. A structural boundary, the same one `eslint.config.mjs` draws — not
 * a per-file permission, and not an allowlist.
 */
export const PRIMITIVE_DIR = "src/components/ui/";

/**
 * Blank out comments, preserving offsets.
 *
 * A prose comment naming a class (a note that some element "no longer needs"
 * one) otherwise parses as a string literal and gets reported as the very
 * violation it describes. Offsets are preserved rather than the text removed so
 * that a line number computed against the original source stays correct.
 */
export function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

/** Capture a balanced region starting at `i`, counting `open`/`close`. */
export function balanced(
  src: string,
  i: number,
  open: string,
  close: string,
): string | null {
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
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    function visit(node: ts.Node) {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        /^h[1-6]$/.test(node.tagName.getText(sourceFile))
      ) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        );
        headings.push({
          file: relative(process.cwd(), file),
          line: line + 1,
          attributes: node.attributes.getText(sourceFile),
        });
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
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
    new RegExp(`\\b${role}(?![\\w-])`).test(attributes),
  );
}
