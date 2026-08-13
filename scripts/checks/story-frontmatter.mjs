/**
 * Guards story frontmatter.
 *
 * `parseStoryFile` (src/lib/services/stories.ts) defaults every field, on
 * purpose: a story with a missing byline should render, not 500. The cost is
 * that genuinely broken frontmatter also renders — degraded, silently, in
 * production. Nothing else in the repo checks these.
 *
 * The three that matter most, and why each is here rather than left to review:
 *
 *   - `slug` vs filename. The route param comes from the filename stem while
 *     the canonical URL comes from `frontmatter.slug`. A mismatch ships a page
 *     whose canonical points at a 404, which no test and no reader notices.
 *   - `faq`. It is the ONLY source of FAQPage JSON-LD; an in-body <FaqBlock> is
 *     hard-wired `emitJsonLd: false`. Reaching for the shortcode looks
 *     equivalent and silently costs the rich result.
 *   - `heroImage` existing on disk. next/image resolves at request time, so a
 *     bad path is a broken image in production and a green build locally.
 *
 * Tag membership is checked by src/lib/taxonomy/__tests__/story-tags.test.ts,
 * which owns the vocabulary. This script does not restate it.
 *
 * Deliberately NOT wired into `pnpm lint`: that script is an `&&` chain, so a
 * failure here would skip every check after it. Run it from the story pipeline
 * and from CI as its own step.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import matter from "gray-matter";

const STORIES_DIR = "content/stories";
const PUBLIC_DIR = "public";
const FAQ_MIN = 4;
const FAQ_MAX = 6;
const LOCALES = new Set(["zh-TW", "en"]);
const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})-(.+)$/;

const failures = [];

function fail(file, message) {
  failures.push(`${file}: ${message}`);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * gray-matter turns an unquoted YAML date into a Date, and a quoted one into a
 * string. Both are legal in a story and both are fine downstream, so accept
 * either rather than forcing authors to remember which.
 */
function isDateLike(value) {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value.trim());
}

function checkStory(file, raw) {
  const { data } = matter(raw);

  for (const field of ["title", "description", "heroImage", "heroImageAlt"]) {
    if (!isNonEmptyString(data[field])) fail(file, `missing \`${field}\``);
  }

  if (!isDateLike(data.publishedAt)) {
    fail(file, "missing or malformed `publishedAt` (expected YYYY-MM-DD)");
  }

  if (!LOCALES.has(data.locale)) {
    fail(file, `\`locale\` must be one of ${[...LOCALES].join(", ")}, got ${JSON.stringify(data.locale)}`);
  }

  const stem = file.replace(/\.mdx$/, "");
  const dated = DATE_PREFIX.exec(stem);
  if (!dated) {
    fail(file, "filename must start with a YYYY-MM-DD- prefix");
  } else if (data.slug !== dated[2]) {
    // The canonical URL uses frontmatter.slug; the route uses the stem.
    fail(
      file,
      `\`slug\` is ${JSON.stringify(data.slug)} but the filename implies ${JSON.stringify(dated[2])} — the canonical URL would point at a 404`,
    );
  }

  if (!Array.isArray(data.tags) || data.tags.length === 0) {
    fail(file, "`tags` must be a non-empty array (membership is checked by story-tags.test.ts)");
  }

  if (!Array.isArray(data.sources) || data.sources.length === 0) {
    fail(file, "`sources` must be a non-empty array of absolute URLs");
  } else {
    for (const source of data.sources) {
      if (typeof source !== "string" || !/^https?:\/\//.test(source)) {
        fail(file, `\`sources\` entry is not an absolute URL: ${JSON.stringify(source)}`);
      }
    }
  }

  if (!Array.isArray(data.faq)) {
    fail(file, "`faq` is required — it is the only source of FAQPage JSON-LD");
  } else if (data.faq.length < FAQ_MIN || data.faq.length > FAQ_MAX) {
    fail(file, `\`faq\` has ${data.faq.length} entries, expected ${FAQ_MIN}-${FAQ_MAX}`);
  } else {
    data.faq.forEach((entry, index) => {
      if (!entry || !isNonEmptyString(entry.q) || !isNonEmptyString(entry.a)) {
        fail(file, `\`faq[${index}]\` needs both \`q\` and \`a\``);
      }
    });
  }

  // Repo-relative hero images must exist; a remote one is the CSP allowlist's
  // problem (ALLOWED_IMAGE_HOSTS), not something this script can resolve.
  if (isNonEmptyString(data.heroImage) && data.heroImage.startsWith("/")) {
    if (!existsSync(join(PUBLIC_DIR, data.heroImage))) {
      fail(file, `\`heroImage\` not found on disk: ${PUBLIC_DIR}${data.heroImage}`);
    }
  }

  // Series membership is all-or-nothing: an id with no order sorts last and
  // silently reverses the reading sequence a series exists to impose.
  if (data.series !== undefined) {
    if (!isNonEmptyString(data.seriesTitle)) {
      fail(file, "`series` is set but `seriesTitle` is missing");
    }
    if (typeof data.seriesOrder !== "number") {
      fail(file, "`series` is set but `seriesOrder` is not a number");
    }
  }
}

let files;
try {
  files = readdirSync(STORIES_DIR).filter(name => name.endsWith(".mdx"));
} catch {
  console.log(`Story frontmatter guard skipped — no ${STORIES_DIR}/ directory.`);
  process.exit(0);
}

for (const file of files.sort()) {
  checkStory(file, readFileSync(join(STORIES_DIR, file), "utf8"));
}

if (failures.length > 0) {
  console.error("Story frontmatter guard failed:\n");
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(
    `\n${failures.length} problem(s) across ${files.length} story file(s).` +
      "\nContract: .claude/skills/write-stories/references/mdx-contract.md",
  );
  process.exit(1);
}

console.log(`Story frontmatter guard passed (${files.length} file(s) scanned).`);
