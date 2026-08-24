import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

/**
 * i18n regression guard — Chinese-in-English direction.
 *
 * User-facing copy must come from `messages/*.json` via next-intl, never be
 * hardcoded. This test fails if any Han ideograph appears in source under
 * `src/` outside the allowlist below. New leaks therefore fail CI.
 *
 * The allowlist holds intentional single-locale or copy-in-source surfaces.
 * It is shared by both assertions below, so an allowlisted file suppresses
 * EVERY hardcoded-copy check in this guard, not only the Han scan that usually
 * motivates the entry. Treat each row as a file-wide exemption.
 * When something here is genuinely intentional (e.g. an admin-only screen),
 * add its path. Otherwise, move the string into `messages/*.json`.
 */

const SRC = join(process.cwd(), "src");

// Han ideographs (main + Ext-A + compatibility). Catches any Chinese string.
const HAN = /[㐀-鿿豈-﫿]/;
const LATIN = /[A-Za-z]/;
const USER_FACING_ATTRIBUTES = new Set([
  "alt",
  "aria-label",
  "description",
  "placeholder",
  "title",
]);

const ALLOWLIST = [
  // Email copy lives in-file and is locale-branched inside the template.
  "lib/email/templates.ts",
  // Language endonyms (中文 / English) — correct in both locales.
  "components/settings/settings-form.tsx",
  // OG images: rendered to PNG, locale-branched or zh default by design.
  "app/opengraph-image.tsx",
  "app/[locale]/brands/[slug]/opengraph-image.tsx",
  // Structured data uses locale-aware labels outside React rendering.
  "lib/json-ld.ts",
  // Non-display Chinese: a comment and scraper keyword regex.
  "lib/constants.ts",
  "lib/services/enrich-phases/scraper/strategies/crawl.ts",
  // Scraper search query uses Chinese keywords to find Taiwan brand websites (not UI copy).
  "lib/services/enrich-phases/scraper/search.ts",
  // Search Console query clustering uses Chinese regex patterns to classify search
  // queries (not UI copy).
  "lib/seo/search-console/segmentation.ts",
  // Enrich-phase labels are admin-only display constants (not user-facing i18n copy).
  "lib/constants/enrich-phases.ts",
  // Enrich-phase search queries use Chinese keywords to find Taiwan brand data (not UI copy).
  "lib/services/enrich-phases/discover.ts",
  "lib/services/enrich-phases/image-search.ts",
  // Curation name arbitration uses Chinese source examples and LLM field labels, not UI copy.
  "lib/services/enrich-phases/links.ts",
  "lib/services/enrich-phases/names.ts",
  "lib/services/name-arbiter.ts",
  // Taxonomy ontology: nameZh is structural data (bilingual label in data layer, not UI copy).
  "lib/taxonomy/ontology.ts",
  // Slug generation regex uses CJK character ranges (not UI copy).
  "lib/services/brands.ts",
  // AI-slop detector uses Chinese regex patterns (not UI copy).
  "lib/services/enrich-validators.ts",
  // Punctuation normalizer: a CJK character-range regex written with literal
  // range endpoints (not UI copy). The vocabulary table is gone.
  "lib/services/taiwan-localization.ts",
  // Subcategory validator uses Chinese blocklist regex patterns (not UI copy).
  "lib/services/subcategories.ts",
  // Brand cleanup uses Chinese keyword arrays and regex patterns (not UI copy).
  "lib/services/brand-cleanup.ts",
  // LLM system prompts centralised module (Chinese prompt text).
  "lib/prompts.ts",
  // LLM user message templates still contain Chinese field labels (not UI copy).
  "lib/services/description-rewrite.ts",
  "lib/services/brand-facts.ts",
  "lib/services/category-classifier.ts",
  "lib/services/reputation-research.ts",
  // Image classify user message includes brand name in Chinese; detect has SEO keyword constants.
  "lib/services/enrich-phases/classify-images.ts",
  "lib/services/enrich-phases/detect.ts",
  // SERP query string uses Chinese keyword '台灣' (not UI copy).
  "lib/services/curation-operations.ts",
  // Submission deduplication comments document production names, not rendered copy.
  "lib/services/submissions.ts",
  // Transitional: real messages come from the i18n factory; static fallback map
  // here is test-only. TODO remove the static fallback and drop this entry.
  "lib/validations/submission.ts",
  // MIT registry parser uses Chinese column header keys from the government CSV dataset (not UI copy).
  "lib/services/mit-registry.ts",
  // MIT verification normalizes Taiwanese legal-entity suffixes (not UI copy).
  "lib/services/mit-verification.ts",
  // Share card is a satori-rendered PNG image (same as OG images) — zh-TW headline by design.
  "lib/growth/share-card.tsx",
  // Badge embed snippet alt text is intentional zh-TW brand copy pasted into third-party sites.
  "lib/growth/share-assets.ts",
  // Stockist name normalization uses Chinese retailer noise words for stripping (data constants, not UI copy).
  "lib/brands/stockist-display.ts",
  // FAQ phase prompt fragments and repair instructions are Chinese model
  // instructions, not UI copy.
  "lib/services/enrich-phases/faq.ts",
  // Region slug-to-label map uses Chinese city names for display (data constants, not UI copy).
  "lib/services/stockists.ts",
  // City labels the curation worker needs outside any request scope. They cannot
  // live in `messages/*.json`: the worker runs `tsx` with no bundler and its
  // image ships no `messages/` directory, so importing the catalog crashes at
  // module resolution (#596). The rendering path still reads the catalog via
  // next-intl — this map is the worker's copy, not the render source.
  "lib/constants/taiwan-cities.ts",
  "lib/constants/taiwan-districts.ts",
];

function isAllowlisted(relPath: string): boolean {
  const p = relPath.split(sep).join("/");
  return ALLOWLIST.some((a) => (a.endsWith("/") ? p.startsWith(a) : p === a));
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function hanOffenders(source: string): Array<{ line: number; value: string }> {
  const offenders: Array<{ line: number; value: string }> = [];
  const sourceFile = ts.createSourceFile(
    "source.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.JSX,
    source,
  );

  for (
    let token = scanner.scan();
    token !== ts.SyntaxKind.EndOfFileToken;
    token = scanner.scan()
  ) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      continue;
    }

    const value = scanner.getTokenText();
    if (!HAN.test(value)) continue;
    const { line } = sourceFile.getLineAndCharacterOfPosition(
      scanner.getTokenPos(),
    );
    offenders.push({ line: line + 1, value: value.trim() });
  }
  return offenders;
}

function renderedCopyOffenders(
  fileName: string,
  source: string,
): Array<{ line: number; value: string }> {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const offenders: Array<{ line: number; value: string }> = [];

  function report(node: ts.Node, value: string) {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!LATIN.test(normalized) || normalized === "Formoria") return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    offenders.push({ line: line + 1, value: normalized });
  }

  function reportExpression(expression: ts.Expression) {
    if (
      ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression)
    ) {
      report(expression, expression.text);
      return;
    }
    if (ts.isTemplateExpression(expression)) {
      report(expression.head, expression.head.text);
      for (const span of expression.templateSpans) {
        reportExpression(span.expression);
        report(span.literal, span.literal.text);
      }
      return;
    }
    if (ts.isConditionalExpression(expression)) {
      reportExpression(expression.whenTrue);
      reportExpression(expression.whenFalse);
      return;
    }
    if (ts.isParenthesizedExpression(expression)) {
      reportExpression(expression.expression);
    }
  }

  function visit(node: ts.Node) {
    if (ts.isJsxText(node)) {
      report(node, node.getText(sourceFile));
    } else if (
      ts.isJsxAttribute(node) &&
      USER_FACING_ATTRIBUTES.has(node.name.getText(sourceFile)) &&
      node.initializer
    ) {
      if (ts.isStringLiteral(node.initializer)) {
        report(node.initializer, node.initializer.text);
      } else if (
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression
      ) {
        reportExpression(node.initializer.expression);
      }
    } else if (
      ts.isJsxExpression(node) &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
      node.expression &&
      ts.isConditionalExpression(node.expression)
    ) {
      reportExpression(node.expression);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return offenders;
}

describe("i18n guard — allowlist hygiene", () => {
  it("every allowlist entry points at a path that exists", () => {
    // A dead entry fails nothing and looks like documentation of a decision
    // that is still live. `lib/preview/` sat here after the directory was
    // deleted, quietly holding a CJK exemption open for a path that could be
    // recreated by anyone, for any reason, with no review.
    const missing = ALLOWLIST.filter(
      (entry) => !existsSync(join(SRC, entry.replace(/\/$/, ""))),
    );

    expect(missing).toEqual([]);
  });
});

describe("i18n guard — no hardcoded Chinese in source", () => {
  it("ignores Han characters in comments while keeping executable Han visible", () => {
    const source = [
      "// 中文說明",
      "const label = '中文標籤';",
    ].join("\n");

    expect(hanOffenders(source)).toEqual([
      { line: 2, value: "'中文標籤'" },
    ]);
  });

  it("source outside the allowlist contains no Han characters", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (isAllowlisted(rel)) continue;
      for (const offender of hanOffenders(readFileSync(file, "utf8"))) {
        offenders.push(
          `${rel.split(sep).join("/")}:${offender.line}  ${offender.value.slice(0, 90)}`,
        );
      }
    }
    expect(
      offenders,
      `Hardcoded Chinese found in source. Move it into messages/*.json (or allowlist if intentional single-locale):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("flags template, literal, and conditional user-facing attributes", () => {
    const offenders = renderedCopyOffenders(
      "fixture.tsx",
      [
        "const name = 'catalogue';",
        "const node = (",
        "  <ConfirmDialog",
        "    aria-label={`Archive ${name}`}",
        '    description="This action cannot be undone"',
        '    title={name ? "Named record" : "Unnamed record"}',
        "  />",
        ");",
      ].join("\n"),
    );

    expect(offenders.map(({ value }) => value)).toEqual([
      "Archive",
      "This action cannot be undone",
      "Named record",
      "Unnamed record",
    ]);
  });

  it("rendered JSX copy outside the allowlist comes from a message catalogue", () => {
    const offenders: string[] = [];

    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (isAllowlisted(rel) || !file.endsWith(".tsx")) continue;

      for (const offender of renderedCopyOffenders(
        file,
        readFileSync(file, "utf8"),
      )) {
        offenders.push(
          `${rel.split(sep).join("/")}:${offender.line}  ${offender.value.slice(0, 90)}`,
        );
      }
    }

    expect(
      offenders,
      `Hardcoded rendered English found in source. Move it into messages/*.json (or document a narrow exception):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
