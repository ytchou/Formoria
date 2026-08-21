/**
 * zh-TW vocabulary gate for user-facing repository text.
 *
 * Fails the lint chain when a mainland-Chinese term from
 * `src/lib/i18n/banned-terms.json` appears in copy a reader can see. The
 * matcher is NOT reimplemented here: this gate imports `detectBannedTerms`
 * from `src/lib/i18n/banned-terms.ts`, the same module the application and the
 * backfill script use, so the gate and the runtime cannot disagree about what
 * a violation is. The lint chain runs this file through `tsx`, exactly as
 * `check:e2e-report` runs its gate. It depends on nothing outside the
 * repository — in particular nothing under `~/.claude`, which CI has not got.
 * The Python checker this replaces was a vendored copy of a shared skill, kept
 * in sync by hand, and drifted from the app's own list by construction.
 *
 * A unit test cannot cover the gate itself: the property is "no violation
 * exists anywhere in the repository", which is a fact about the file tree, not
 * about a function. `scripts/check-zh-terms.test.ts` covers the scanners and
 * asserts the tree is clean today; this script is what fails the build.
 *
 * What is scanned, and why that is the whole user-facing surface:
 *
 *  - `messages/*.json`  — every rendered string in the app. Walked by key
 *    path, and violations report the key path (`brands.filters.appliedHint`)
 *    rather than a line number, because that is what an author edits.
 *  - `content/**\/*.mdx` — stories and trails, published PROSE only. Fenced
 *    code blocks, inline code spans and HTML comments are blanked before
 *    scanning (`stripNonProse`), because a term inside a code sample is not
 *    copy — this restores what the deleted Python checker's `strip_non_prose`
 *    did.
 *  - `src/` — reduces to a single file. `src/i18n/__tests__/no-hardcoded-cjk.test.ts`
 *    already proves that every file under `src/` outside its path-exact
 *    allowlist contains no Han character at all, so a banned term cannot hide
 *    there. Scanning `src/` therefore means scanning that allowlist, and of
 *    those entries only `lib/taxonomy/ontology.ts` renders to a reader — its
 *    `nameZh` values are the public category labels. Every other entry is
 *    classified in EXCLUDED_SOURCE_FILES below with the reason it is not
 *    reader-visible. ALLOWLIST_SYNC keeps the two lists honest: an allowlist
 *    entry classified in neither list fails this check.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { detectBannedTerms } from "../src/lib/i18n/banned-terms";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface Violation {
  file: string;
  /** A dotted key path for catalogues, a 1-based line number for prose. */
  location: string;
  term: string;
  replacement: string;
}

/**
 * Blank out everything in an MDX file that is not prose — fenced code blocks,
 * inline code spans and HTML comments — replacing each character with a space
 * so byte offsets, and therefore reported line numbers, are unchanged.
 *
 * A banned term inside a code sample is not copy a reader is being addressed
 * with; flagging it would push authors to allowlist the whole file.
 */
export function stripNonProse(text: string): string {
  const blank = (match: string) => match.replace(/[^\n]/g, " ");
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, blank)
    .replace(/`[^`\n]*`/g, blank)
    .replace(/<!--[\s\S]*?(?:-->|$)/g, blank);
}

/**
 * Scan free text and locate each hit by 1-based line number.
 */
export function scanText(text: string, file: string): Violation[] {
  return detectBannedTerms(text).map((hit) => ({
    file,
    location: String(text.slice(0, hit.offset).split("\n").length),
    term: hit.term,
    replacement: hit.replacement,
  }));
}

/**
 * Walk a parsed message catalogue and locate each hit by dotted key path.
 * Key names themselves are never scanned — they are ASCII identifiers, and a
 * line number in a 5000-line catalogue tells an author nothing.
 */
export function scanJsonValue(
  value: unknown,
  file: string,
  keyPath = "",
): Violation[] {
  if (typeof value === "string") {
    return detectBannedTerms(value).map((hit) => ({
      file,
      location: keyPath,
      term: hit.term,
      replacement: hit.replacement,
    }));
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      scanJsonValue(
        entry,
        file,
        keyPath ? `${keyPath}.${index}` : String(index),
      ),
    );
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, entry]) =>
        scanJsonValue(entry, file, keyPath ? `${keyPath}.${key}` : key),
    );
  }

  return [];
}

/**
 * The only file under `src/` that renders Han to a reader. Its `nameZh` values
 * are the public L1/L2 category labels on /brands and every category page.
 */
const SCANNED_SOURCE_FILES = ["src/lib/taxonomy/ontology.ts"];

/**
 * Every other entry in the no-hardcoded-cjk allowlist, with the reason its Han
 * text is not reader-visible. Keyed by the allowlist's own `src/`-relative
 * form so ALLOWLIST_SYNC can compare them directly.
 */
const EXCLUDED_SOURCE_FILES = new Map([
  // --- LLM prompts and model instructions. The banned terms appear here on
  // purpose: several prompts name the words the model must not produce.
  ["lib/prompts.ts", "LLM system prompts — model instructions, never rendered"],
  ["lib/services/description-rewrite.ts", "LLM user-message template"],
  ["lib/services/brand-facts.ts", "LLM user-message template"],
  ["lib/services/category-classifier.ts", "LLM user-message template"],
  ["lib/services/reputation-research.ts", "LLM user-message template"],
  ["lib/services/name-arbiter.ts", "LLM field labels and source examples"],
  [
    "lib/services/enrich-phases/names.ts",
    "LLM field labels and source examples",
  ],
  [
    "lib/services/enrich-phases/links.ts",
    "LLM field labels and source examples",
  ],
  ["lib/services/enrich-phases/classify-images.ts", "LLM user message"],
  [
    "lib/services/enrich-phases/faq.ts",
    "LLM prompt fragments and repair instructions",
  ],
  ["lib/brands/faq-presets/", "LLM prompt fragments"],
  // --- Scraper and search keyword lists. Chinese query strings sent to search
  // engines and crawlers, matched against third-party pages, never displayed.
  [
    "lib/services/enrich-phases/scraper/strategies/crawl.ts",
    "scraper keyword regex",
  ],
  ["lib/services/enrich-phases/scraper/search.ts", "search-query keywords"],
  ["lib/services/enrich-phases/discover.ts", "search-query keywords"],
  ["lib/services/enrich-phases/image-search.ts", "search-query keywords"],
  ["lib/services/enrich-phases/detect.ts", "SEO keyword constants"],
  ["lib/services/curation-operations.ts", "SERP query string"],
  ["lib/services/brand-cleanup.ts", "cleanup keyword arrays and regexes"],
  ["lib/services/subcategories.ts", "validator blocklist regexes"],
  ["lib/services/enrich-validators.ts", "AI-slop detector regexes"],
  ["lib/seo/search-console/segmentation.ts", "query-clustering regexes"],
  ["lib/services/mit-registry.ts", "government CSV column headers"],
  ["lib/services/mit-verification.ts", "legal-entity suffix normalisation"],
  [
    "lib/brands/stockist-display.ts",
    "retailer noise words stripped before display",
  ],
  // --- Character-range regexes. No word appears at all, only range endpoints,
  // so a term match here would be a false positive by construction.
  [
    "lib/services/taiwan-localization.ts",
    "CJK character-range regex, no vocabulary",
  ],
  ["lib/services/brands.ts", "CJK character-range regex for slug generation"],
  ["lib/constants.ts", "CJK range regex and a comment"],
  // --- Fixtures, comments, and test-only fallbacks.
  ["lib/services/submissions.ts", "comments documenting production names"],
  [
    "lib/validations/submission.ts",
    "test-only static fallback map (transitional)",
  ],
  // --- Reader-visible, but out of this gate's declared scope (DEV-1543 scoped
  // the source side to the taxonomy ontology). Each is real zh-TW copy and is
  // clean today; widening the gate to cover them is a follow-up, not a
  // silent expansion here.
  //
  // Ceiling: a banned term added to microsite, transactional-email or
  // structured-data copy passes this gate today. Upgrade path: move the entry
  // from EXCLUDED_SOURCE_FILES to SCANNED_SOURCE_FILES — the allowlist-sync
  // check already forces every allowlisted file to be classified in exactly
  // one of the two, so nothing else has to change. Verified clean at the time
  // of writing, so the move is free whenever someone wants the wider net.
  [
    "components/microsite/",
    "zh-TW-only microsite copy — out of scope, see header",
  ],
  ["app/(microsite)/", "zh-TW-only microsite copy — out of scope, see header"],
  [
    "lib/email/templates.ts",
    "transactional email copy — out of scope, see header",
  ],
  [
    "components/dashboard/inline-verification.tsx",
    "owner mailto subject — out of scope",
  ],
  ["components/settings/settings-form.tsx", "language endonyms only"],
  ["app/opengraph-image.tsx", "rendered to PNG — out of scope"],
  [
    "app/[locale]/brands/[slug]/opengraph-image.tsx",
    "rendered to PNG — out of scope",
  ],
  ["lib/growth/share-card.tsx", "rendered to PNG — out of scope"],
  ["lib/growth/share-assets.ts", "embed snippet alt text — out of scope"],
  ["lib/json-ld.ts", "structured-data labels — out of scope"],
  ["lib/constants/enrich-phases.ts", "admin-only phase labels"],
  ["lib/constants/taiwan-cities.ts", "city names — the curation worker copy"],
  [
    "lib/constants/taiwan-districts.ts",
    "district names — the curation worker copy",
  ],
  ["lib/services/stockists.ts", "region slug-to-label map"],
]);

/** The allowlist this gate reduces `src/` to. */
const CJK_ALLOWLIST_SOURCE = "src/i18n/__tests__/no-hardcoded-cjk.test.ts";

/**
 * Read the allowlist entries out of the hardcoded-CJK guard. A line-anchored
 * parse is enough: the array holds string literals, one per line.
 */
function readCjkAllowlist(): string[] {
  const source = readFileSync(join(ROOT, CJK_ALLOWLIST_SOURCE), "utf8");
  const block = source.match(/const ALLOWLIST = \[([\s\S]*?)\n\]/);
  if (!block) {
    throw new Error(
      `Could not find ALLOWLIST in ${CJK_ALLOWLIST_SOURCE}; update the parser in scripts/check-zh-terms.ts.`,
    );
  }
  return [...block[1]!.matchAll(/^\s*"([^"]+)",/gm)].map((match) => match[1]!);
}

/**
 * Every allowlisted file must be either scanned or excluded with a reason.
 * Without this, a new allowlist entry — a new file permitted to hold Han in
 * source — would silently escape the gate.
 */
export function allowlistSyncProblems(): string[] {
  const scanned = new Set(
    SCANNED_SOURCE_FILES.map((path) => path.replace(/^src\//, "")),
  );
  const problems: string[] = [];

  for (const entry of readCjkAllowlist()) {
    if (scanned.has(entry) || EXCLUDED_SOURCE_FILES.has(entry)) continue;
    problems.push(
      `${CJK_ALLOWLIST_SOURCE} allows Han in "src/${entry}", which scripts/check-zh-terms.ts classifies nowhere.\n` +
        "  Add it to SCANNED_SOURCE_FILES (user-facing) or EXCLUDED_SOURCE_FILES (with the reason it is not).",
    );
  }

  return problems;
}

/** @param file repo-relative path */
export function isScannedSourceFile(file: string): boolean {
  return SCANNED_SOURCE_FILES.includes(file.split(sep).join("/"));
}

/**
 * Scan a `src/` file, but only if it is one this gate covers.
 */
export function scanSourceFile(file: string): Violation[] {
  if (!isScannedSourceFile(file)) return [];
  return scanText(readFileSync(join(ROOT, file), "utf8"), file);
}

/** Every file under `dir` matching `pattern`, as sorted repo-relative paths. */
function walk(dir: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, pattern));
    } else if (pattern.test(entry.name)) {
      out.push(relative(ROOT, full).split(sep).join("/"));
    }
  }
  return out.sort();
}

/**
 * Scan every user-facing file in the repository.
 */
export function collectViolations(): Violation[] {
  const violations: Violation[] = [];

  for (const file of walk(join(ROOT, "messages"), /\.json$/)) {
    violations.push(
      ...scanJsonValue(
        JSON.parse(readFileSync(join(ROOT, file), "utf8")),
        file,
      ),
    );
  }

  for (const file of walk(join(ROOT, "content"), /\.mdx$/)) {
    violations.push(
      ...scanText(stripNonProse(readFileSync(join(ROOT, file), "utf8")), file),
    );
  }

  for (const file of SCANNED_SOURCE_FILES) {
    violations.push(...scanSourceFile(file));
  }

  return violations;
}

/** One line per violation; empty when clean. */
export function formatViolations(violations: readonly Violation[]): string {
  return violations
    .map((v) => `  ${v.file}  ${v.location}  ${v.term} -> ${v.replacement}`)
    .join("\n");
}

function main(): void {
  const problems = allowlistSyncProblems();
  const violations = collectViolations();

  if (problems.length === 0 && violations.length === 0) {
    console.log("zh-TW vocabulary gate passed.");
    return;
  }

  if (violations.length > 0) {
    console.error(
      "Mainland-Chinese vocabulary found in user-facing text. Replace each term\n" +
        "with its zh-TW form (the list lives in src/lib/i18n/banned-terms.json):",
    );
    console.error(formatViolations(violations));
  }

  if (problems.length > 0) {
    if (violations.length > 0) console.error("");
    console.error(problems.join("\n"));
  }

  process.exitCode = 1;
}

// `pathToFileURL` percent-encodes exactly as `import.meta.url` does. A
// hand-built `file://${path}` compares false for any checkout path holding a
// space or a non-ASCII character, and the gate would then exit 0 in silence.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
