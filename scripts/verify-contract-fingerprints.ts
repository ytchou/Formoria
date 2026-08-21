/**
 * Compares the LIVE Postgres function fingerprints of a Supabase project
 * against the recorded 2026-08-19 contract baseline.
 *
 * Four of the contract functions have no source file — they were hand-patched
 * in place — so a migration run is the only thing that would overwrite them and
 * nothing in the repo would notice. This script is the pre-flight gate for a
 * production cutover: it reads `md5(pg_get_functiondef(...))` for the 12
 * contract functions through the Management API in READ-ONLY mode and fails
 * loudly on any drift, missing function, or unexpected extra overload.
 *
 * Usage:
 *   pnpm exec tsx scripts/verify-contract-fingerprints.ts \
 *     --ref <project-ref> --token <access-token> [--baseline <path>]
 *
 * The project ref and the access token are always explicit: no ref is hardcoded
 * here, and no `.env*` file is read, so pointing this at production is a
 * deliberate act. `--token` may be omitted when `SUPABASE_ACCESS_TOKEN` is set
 * in the process environment.
 *
 * The baseline report lives under `docs/`, which is gitignored — the default
 * path below therefore resolves only on a machine that has it. Pass
 * `--baseline` for any other copy.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

export const DEFAULT_BASELINE_PATH = resolve(
  ROOT,
  "docs/reports/2026-08-19-dev-1503-contract-function-baseline.md",
);

/**
 * The `proname` list the live query filters on. `brands_track_content_provenance`
 * is not one of the plan's 11 contract functions — it is a trigger the same
 * tables depend on, recorded in the baseline's prose rather than its table, and
 * a cutover that silently replaced it would be just as invisible.
 */
export const CONTRACT_FUNCTION_NAMES = [
  "apply_brand_refresh",
  "apply_brand_refresh_with_protected_location_gate",
  "approve_submission",
  "approve_submission_with_romanized_name",
  "save_submission_review",
  "correct_approved_submission_provenance",
  "brand_trgm_rank",
  "brands_search_document",
  "brands_search_vector_update",
  "search_brand_page",
  "search_brands",
  "brands_track_content_provenance",
] as const;

export type FingerprintRow = {
  signature: string;
  md5: string;
};

export type ComparisonStatus = "match" | "MISMATCH" | "MISSING" | "UNEXPECTED";

export type ComparisonRow = {
  signature: string;
  liveMd5: string | null;
  expectedMd5: string | null;
  status: ComparisonStatus;
};

const MD5_PATTERN = /^[0-9a-f]{32}$/;
const SIGNATURE_PATTERN = /`([A-Za-z_][A-Za-z0-9_]*\([^`]*\))`/;
const PROSE_MD5_PATTERN = /MD5\s+`([0-9a-f]{32})`/;

function stripBackticks(cell: string): string {
  return cell.trim().replace(/^`/, "").replace(/`$/, "").trim();
}

/**
 * Parses the baseline report into `{ signature, md5 }` pairs.
 *
 * Two shapes carry fingerprints: the 8-column markdown table (signature in the
 * first cell, MD5 in the last, both backticked) and a prose paragraph for the
 * trigger function that sits outside the table. Both are parsed; the table wins
 * on any duplicate signature.
 */
export function parseBaselineReport(report: string): FingerprintRow[] {
  const lines = report.split("\n");
  const rows: FingerprintRow[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1);
    if (cells.length < 2) continue;
    const signature = stripBackticks(cells[0] ?? "");
    const md5 = stripBackticks(cells[cells.length - 1] ?? "");
    if (!signature.includes("(") || !MD5_PATTERN.test(md5)) continue;
    if (seen.has(signature)) continue;
    seen.add(signature);
    rows.push({ signature, md5 });
  }

  const prose = lines.filter((line) => !line.trim().startsWith("|")).join("\n");
  for (const paragraph of prose.split(/\n\s*\n/)) {
    const md5 = paragraph.match(PROSE_MD5_PATTERN)?.[1];
    const signature = paragraph.match(SIGNATURE_PATTERN)?.[1];
    if (!md5 || !signature) continue;
    if (seen.has(signature)) continue;
    seen.add(signature);
    rows.push({ signature, md5 });
  }

  return rows;
}

/** The read-only catalog dump the live side runs. */
export function buildFingerprintQuery(
  names: readonly string[] = CONTRACT_FUNCTION_NAMES,
): string {
  const list = names.map((name) => `'${name}'`).join(", ");
  return [
    "select p.oid::regprocedure::text as signature,",
    "       md5(pg_get_functiondef(p.oid)) as md5",
    "from pg_proc p",
    "join pg_namespace n on n.oid = p.pronamespace",
    "where n.nspname = 'public'",
    `  and p.proname in (${list})`,
    "order by 1;",
  ].join("\n");
}

/**
 * Normalises the signature text so a baseline row and a live row compare.
 * `regprocedure` renders argument lists without spaces, but a report edited by
 * hand can pick some up.
 */
function normalizeSignature(signature: string): string {
  return signature.replace(/\s+/g, "");
}

export function compareFingerprints(
  baseline: readonly FingerprintRow[],
  live: readonly FingerprintRow[],
): ComparisonRow[] {
  const liveBySignature = new Map(
    live.map((row) => [normalizeSignature(row.signature), row]),
  );
  const rows: ComparisonRow[] = [];

  for (const expected of baseline) {
    const key = normalizeSignature(expected.signature);
    const found = liveBySignature.get(key);
    liveBySignature.delete(key);
    rows.push({
      signature: expected.signature,
      liveMd5: found?.md5 ?? null,
      expectedMd5: expected.md5,
      status: !found
        ? "MISSING"
        : found.md5 === expected.md5
          ? "match"
          : "MISMATCH",
    });
  }

  for (const extra of liveBySignature.values()) {
    rows.push({
      signature: extra.signature,
      liveMd5: extra.md5,
      expectedMd5: null,
      status: "UNEXPECTED",
    });
  }

  return rows;
}

export function formatComparison(rows: readonly ComparisonRow[]): string {
  return rows
    .map(
      (row) =>
        `${row.signature} | ${row.liveMd5 ?? "-"} | ${row.expectedMd5 ?? "-"} | ${row.status}`,
    )
    .join("\n");
}

export function hasDrift(rows: readonly ComparisonRow[]): boolean {
  return rows.some((row) => row.status !== "match");
}

/**
 * Removes every credential-shaped value from text bound for stdout/stderr.
 * A leaked token in an error message is as bad as a leaked token in a log line,
 * so this wraps the failure path too.
 */
export function redactSecrets(
  text: string,
  secrets: ReadonlyArray<string | undefined>,
): string {
  let output = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue;
    output = output.split(secret).join("[redacted]");
  }
  return output;
}

export type FetchLiveFingerprints = (input: {
  projectRef: string;
  token: string;
  sql: string;
}) => Promise<FingerprintRow[]>;

/**
 * The one network call. `read_only: true` is not optional: this script must be
 * safe to point at production before a cutover, and the Management API enforces
 * the read-only transaction server-side.
 */
export const fetchLiveFingerprints: FetchLiveFingerprints = async ({
  projectRef,
  token,
  sql,
}) => {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql, read_only: true }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Management API query failed (${response.status}): ${body.slice(0, 500)}`,
    );
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("Management API returned an unexpected payload shape");
  }

  return payload.map((entry) => {
    const row = entry as { signature?: unknown; md5?: unknown };
    if (typeof row.signature !== "string" || typeof row.md5 !== "string") {
      throw new Error("Management API row is missing signature or md5");
    }
    return { signature: row.signature, md5: row.md5 };
  });
};

export type CliOptions = {
  projectRef: string;
  token: string;
  baselinePath: string;
};

export function parseCliArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): CliOptions {
  let projectRef = "";
  let token = env.SUPABASE_ACCESS_TOKEN ?? "";
  let baselinePath = DEFAULT_BASELINE_PATH;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--ref":
      case "--token":
      case "--baseline": {
        if (!value || value.startsWith("--")) {
          throw new Error(`${flag} requires a value`);
        }
        if (flag === "--ref") projectRef = value;
        else if (flag === "--token") token = value;
        else baselinePath = resolve(value);
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown argument "${flag}"`);
    }
  }

  if (!projectRef) {
    throw new Error("--ref <project-ref> is required");
  }
  if (!token) {
    throw new Error(
      "--token <access-token> is required (or set SUPABASE_ACCESS_TOKEN)",
    );
  }

  return { projectRef, token, baselinePath };
}

export type MainDependencies = {
  readBaseline?: (path: string) => string;
  fetchLiveFingerprints?: FetchLiveFingerprints;
  env?: NodeJS.ProcessEnv;
};

/** Returns the process exit code; the CLI entry below assigns it. */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  deps: MainDependencies = {},
): Promise<number> {
  const readBaseline =
    deps.readBaseline ?? ((path: string) => readFileSync(path, "utf8"));
  const fetchLive = deps.fetchLiveFingerprints ?? fetchLiveFingerprints;
  const env = deps.env ?? process.env;

  // Parsed before the try/catch has a token to redact, so nothing here may
  // echo an argument value back.
  let options: CliOptions;
  try {
    options = parseCliArgs(argv, env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const secrets = [options.token, env.SUPABASE_ACCESS_TOKEN];

  try {
    const baseline = parseBaselineReport(readBaseline(options.baselinePath));
    if (baseline.length === 0) {
      console.error(
        redactSecrets(
          `No fingerprints parsed from ${options.baselinePath}`,
          secrets,
        ),
      );
      return 1;
    }

    const live = await fetchLive({
      projectRef: options.projectRef,
      token: options.token,
      sql: buildFingerprintQuery(),
    });

    const comparison = compareFingerprints(baseline, live);
    console.log(redactSecrets(formatComparison(comparison), secrets));

    if (hasDrift(comparison)) {
      const drifted = comparison.filter((row) => row.status !== "match").length;
      console.error(
        `Contract fingerprint check FAILED: ${drifted} of ${comparison.length} functions differ from the baseline`,
      );
      return 1;
    }

    console.log(
      `Contract fingerprint check passed: ${comparison.length} functions match the baseline`,
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(redactSecrets(message, secrets));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
