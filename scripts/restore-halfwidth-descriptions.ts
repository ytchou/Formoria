/**
 * @formoria-script
 * purpose: Restores half-width model numbers and years in brand descriptions and blurbs corrupted to full-width forms or Chinese numerals.
 * class: operator
 * invoke: pnpm exec tsx scripts/restore-halfwidth-descriptions.ts
 * target: staging-default
 * safety: writes-on-apply
 * owner: engineering
 */
/**
 * One-off text repair for DEV-1954 (BD-06).
 *
 * The descriptions phase learned to pass the zh language-purity gate by
 * "Chinese-ifying" model numbers: the scorer counted full-width letters as CJK
 * and the retry guidance told the model to rewrite foreign proper nouns into
 * Chinese. Stored descriptions therefore carry 「ＭＤ－八六〇Ｓ」 for MD-860S,
 * 「ＯＥＫＯ－ＴＥＸ」, 「三Ｄ」, 「三Ｃ」 and 「二〇一二年」. The generator is
 * fixed in the same change; this script repairs the rows already written.
 *
 * NOT RUN. It shipped unexecuted. The reviewer must read the full dry-run
 * output before passing `--apply`: the numeral rule is conservative but still
 * a heuristic, and fields listed as "needs human review" carry positional
 * numerals (七百五十) the script deliberately leaves alone.
 *
 * The write goes straight to `brands`, bypassing the approval queue, on
 * purpose: this is a mechanical text repair of content the pipeline already
 * approved, the same class as `scripts/backfill-tw-localization.ts`. Each
 * update carries an optimistic guard (`.eq(column, before)`), so a field edited
 * since the scan is skipped and reported rather than overwritten.
 *
 * Usage:
 *   pnpm exec tsx scripts/restore-halfwidth-descriptions.ts                      # dry run, staging
 *   pnpm exec tsx scripts/restore-halfwidth-descriptions.ts --only=yates,rmc     # dry run, two slugs
 *   pnpm exec tsx scripts/restore-halfwidth-descriptions.ts --apply              # write, staging
 *   pnpm exec tsx scripts/restore-halfwidth-descriptions.ts --target production  # dry run, production
 */
import { pathToFileURL } from "node:url";

import { foldFullWidthAlphanumerics } from "@/lib/services/taiwan-localization";
import { createServiceClient } from "@/lib/supabase/service";
import { loadScriptTarget } from "./shared/target";

const TEXT_COLUMNS = [
  "description",
  "description_en",
  "blurb",
  "blurb_en",
] as const;
type TextColumn = (typeof TEXT_COLUMNS)[number];

type BrandTextRow = { id: string; slug: string } & Record<
  TextColumn,
  string | null
>;

// PostgREST caps an unpaged select at 1000 rows.
const PAGE_SIZE = 1000;

const FULL_WIDTH_ALPHANUMERIC = /[Ａ-Ｚａ-ｚ０-９]/u;
const DIGIT_WISE_NUMERAL_RUN = /[〇一二三四五六七八九]+/gu;
const ASCII_ALPHANUMERIC = /^[A-Za-z0-9]$/u;
const HYPHEN = /^[-－]$/u;
const NUMERAL_DIGIT: Record<string, string> = {
  "〇": "0",
  "一": "1",
  "二": "2",
  "三": "3",
  "四": "4",
  "五": "5",
  "六": "6",
  "七": "7",
  "八": "8",
  "九": "9",
};
// A digit followed by a unit (七百五十, 三十). These are read as quantities,
// not digit strings, and are never converted — only reported.
const POSITIONAL_NUMERAL =
  /(?:[〇一二三四五六七八九兩][十百千萬])+[〇一二三四五六七八九]?/gu;

function isAsciiAlphanumeric(char: string | undefined): boolean {
  return char !== undefined && ASCII_ALPHANUMERIC.test(char);
}

function isHyphen(char: string | undefined): boolean {
  return char !== undefined && HYPHEN.test(char);
}

/**
 * A digit-wise numeral run is part of a model number when it touches an ASCII
 * letter or digit directly (三D) or through a hyphen that joins it to one
 * (MD-八六〇S).
 *
 * One exception: a single numeral that touches ASCII only on its LEFT is not
 * converted. Prose naming a brand runs straight into 一 (「inBlooom一直使用」),
 * and turning that into 「inBlooom1直」 would corrupt correct text. The
 * corrupted forms seen in production (三D, 三C, 八六〇S) all touch on the right.
 */
function touchesModelNumber(text: string, start: number, end: number): boolean {
  const single = end - start === 1;
  return (
    (!single && isAsciiAlphanumeric(text[start - 1])) ||
    isAsciiAlphanumeric(text[end]) ||
    (isHyphen(text[start - 1]) && isAsciiAlphanumeric(text[start - 2])) ||
    (isHyphen(text[end]) && isAsciiAlphanumeric(text[end + 1]))
  );
}

// A positional number written straight into a model token (十八K, 十四K). The
// digit-wise pass alone would convert only the 八 and leave 「十8K」.
const POSITIONAL_BEFORE_ASCII = /[〇一二三四五六七八九十百千]+(?=[A-Za-z0-9])/gu;
const POSITIONAL_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
// The corrupted form of a decimal such as 0.98 (「零點九八」).
const CHINESE_DECIMAL = /零點([〇一二三四五六七八九]+)/gu;

function parsePositional(run: string): number {
  let total = 0;
  let digit = 0;
  for (const char of run) {
    const unit = POSITIONAL_UNIT[char];
    if (unit === undefined) {
      digit = Number(NUMERAL_DIGIT[char] ?? 0);
      continue;
    }
    total += (digit === 0 ? 1 : digit) * unit;
    digit = 0;
  }
  return total + digit;
}

function convertPositionalBeforeAscii(text: string): string {
  return text.replace(POSITIONAL_BEFORE_ASCII, (run: string) =>
    /[十百千]/u.test(run) ? String(parsePositional(run)) : run,
  );
}

function convertNumeralRuns(text: string): string {
  return text.replace(
    DIGIT_WISE_NUMERAL_RUN,
    (run: string, offset: number, whole: string) => {
      const end = offset + run.length;
      const isYear = run.length === 4 && whole[end] === "年";
      if (!isYear && !touchesModelNumber(whole, offset, end)) return run;
      return Array.from(run, (char) => NUMERAL_DIGIT[char] ?? char).join("");
    },
  );
}

/**
 * Repairs one stored text: folds full-width letters and digits to half-width,
 * then turns digit-wise Chinese numeral runs back into Arabic digits where they
 * are part of a model number (「MD-八六〇S」→「MD-860S」, 「三D」→「3D」) or a
 * four-digit year (「二〇一二年」→「2012年」). Positional numerals such as
 * 七百五十 are left untouched.
 */
export function restoreHalfWidth(text: string): string {
  let restored = convertPositionalBeforeAscii(foldFullWidthAlphanumerics(text));
  restored = restored.replace(
    CHINESE_DECIMAL,
    (_match, digits: string) =>
      `0.${Array.from(digits, (char) => NUMERAL_DIGIT[char] ?? char).join("")}`,
  );
  // A converted run can make its neighbour adjacent to ASCII (八六〇-一), so
  // repeat until stable; real model numbers settle in one or two passes.
  for (let pass = 0; pass < 5; pass += 1) {
    const next = convertNumeralRuns(restored);
    if (next === restored) break;
    restored = next;
  }
  // Joiners between a letter and a just-converted digit (MD－860S) fold now.
  return foldFullWidthAlphanumerics(restored);
}

/** Positional numerals (七百五十) a human should check by hand. */
export function findPositionalNumerals(text: string): string[] {
  return [...new Set(text.match(POSITIONAL_NUMERAL) ?? [])];
}

function parseOnly(argv: readonly string[]): string[] {
  return (
    argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length) ??
    ""
  )
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error);
}

async function fetchCandidateRows(
  supabase: ReturnType<typeof createServiceClient>,
  only: readonly string[],
): Promise<BrandTextRow[]> {
  const rows: BrandTextRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from("brands")
      .select(["id", "slug", ...TEXT_COLUMNS].join(", "))
      .order("id", { ascending: true });
    if (only.length > 0) query = query.in("slug", only);

    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`brands page at ${from}: ${error.message}`);

    const page = (data ?? []) as unknown as BrandTextRow[];
    for (const row of page) {
      const hit = TEXT_COLUMNS.some((column) => {
        const value = row[column];
        return typeof value === "string" && FULL_WIDTH_ALPHANUMERIC.test(value);
      });
      if (hit) rows.push(row);
    }
    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

async function main(): Promise<void> {
  const { argv } = loadScriptTarget();
  const apply = argv.includes("--apply");
  const only = parseOnly(argv);

  console.log(
    `[restore-halfwidth] mode: ${apply ? "APPLY" : "DRY RUN (pass --apply)"}`,
  );
  if (only.length > 0) {
    console.log(`[restore-halfwidth] only: ${only.join(", ")}`);
  }

  const supabase = createServiceClient();
  const rows = await fetchCandidateRows(supabase, only);
  console.log(`[restore-halfwidth] rows with full-width letters or digits: ${rows.length}`);

  let changedFields = 0;
  let written = 0;
  const skipped: string[] = [];
  const failures: string[] = [];
  const needsReview: string[] = [];

  for (const row of rows) {
    for (const column of TEXT_COLUMNS) {
      const before = row[column];
      if (typeof before !== "string") continue;
      const after = restoreHalfWidth(before);

      const positional = findPositionalNumerals(after);
      if (positional.length > 0) {
        needsReview.push(`${row.slug}.${column}: ${positional.join("、")}`);
      }

      if (after === before) continue;
      changedFields += 1;

      console.log(`\n=== ${row.slug} · ${column}`);
      console.log(`before: ${before}`);
      console.log(`after:  ${after}`);

      if (!apply) continue;

      try {
        const { data, error } = await supabase
          .from("brands")
          .update({ [column]: after })
          .eq("id", row.id)
          .eq(column, before)
          .select("id");
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) {
          skipped.push(`${row.slug}.${column} (edited since the scan)`);
          console.log("SKIPPED: field changed since the scan");
          continue;
        }
        written += 1;
        console.log("WRITTEN");
      } catch (error) {
        failures.push(`${row.slug}.${column} — ${describeError(error)}`);
        console.error(`FAILED: ${describeError(error)}`);
      }
    }
  }

  console.log(
    `\n[restore-halfwidth] rows scanned: ${rows.length}  fields to change: ${changedFields}` +
      (apply
        ? `  written: ${written}  skipped: ${skipped.length}  failed: ${failures.length}`
        : ""),
  );
  for (const entry of skipped) console.log(`  skipped: ${entry}`);
  for (const entry of failures) console.log(`  fail: ${entry}`);
  for (const entry of needsReview) {
    console.log(`  needs human review (positional numeral): ${entry}`);
  }
}

// `pathToFileURL` is the repo's entry-guard idiom (see backfill-tw-localization.ts):
// importing `restoreHalfWidth` from a test must not run the script.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main().catch((error) => {
    console.error(describeError(error));
    process.exitCode = 1;
  });
}
