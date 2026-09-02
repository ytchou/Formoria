import type { AgentNotification } from "@/lib/adapters/slack/notification";
import { auditedCall } from "@/lib/audit";
import { describeError } from "@/lib/errors";
import { createServiceClient } from "@/lib/supabase/service";
import {
  LINK_FIELD_TO_COLUMN,
  type LinkColumn,
  type LinkField,
} from "@/lib/types/link-fields";
import type { BrandWriteActor, SkippedBrandField } from "./brand-write-policy";
import { updateBrand, type BrandWriteInput } from "./brands";
import { checkUrl, type LinkFailureReason } from "./link-health";

/**
 * The HTTP status codes and connection failure reason that authorize an
 * automatic null.
 *
 * 404 and 410 are the two responses that mean the resource is gone as a fact
 * about the origin, not as a fact about this request: 404 "not here", 410
 * "deliberately removed". Everything else the link checker can record is
 * transient or ambiguous and is deliberately excluded:
 *   - 5xx: the origin is broken right now, not the URL. A shop that 500s during
 *     a deploy would lose its purchase link permanently.
 *   - 402 / 405: a payment wall or a method the origin refuses for HEAD/GET
 *     probes. The page is usually still there for a real visitor.
 *   - `last_status_code IS NULL` with any reason other than `dns`: no HTTP
 *     response at all (TLS error, timeout, reset, or an ambiguous failure).
 *     That is a statement about the network path, and our own checker's egress
 *     is part of that path.
 * The asymmetry is intentional. A missed cleanup costs one stale link in an
 * admin report; a false null costs a brand real outbound traffic and can only
 * be repaired by hand. When in doubt, leave the link alone.
 */
export const AUTO_NULL_STATUS_CODES: ReadonlySet<number> = new Set([404, 410]);
const AUTO_NULL_FAILURE_REASONS: ReadonlySet<LinkFailureReason> = new Set([
  "dns",
]);

type LinkCleanupApplied = {
  brandId: string;
  brandName: string | null;
  field: string;
  url: string;
  statusCode: number | null;
};

type LinkCleanupSkipped = {
  brandId: string;
  field: string;
  url: string;
  reason: string;
};

export type LinkCleanupResult = {
  applied: LinkCleanupApplied[];
  skipped: LinkCleanupSkipped[];
  /** Rows the candidate query matched, before any per-row classification. */
  scanned: number;
};

type CandidateRow = {
  id: string;
  brand_id: string;
  field: string;
  url: string;
  last_status_code: number | null;
  failure_reason: LinkFailureReason | null;
  /** PostgREST returns an embedded to-one either as an object or a 1-element array. */
  brands: { name: string | null } | { name: string | null }[] | null;
};

type QueryResult<T> = Promise<{ data: T; error: { message: string } | null }>;

export type LinkCleanupRecentRemoval = {
  brandName: string | null;
  field: string;
  url: string;
  removedAt: string;
};

/**
 * Links auto-nulled inside a recent window, newest first.
 *
 * A run only ever reports its *own* removals, so a scheduled run that finds
 * nothing left to do reports nothing — which reads as "no dead links" when the
 * truth may be "they were removed an hour ago by a manual run". The nightly
 * Slack message carries this so the channel reflects what happened to the data,
 * not merely what this particular invocation did.
 *
 * Deliberately its own reader with its own seam: `LinkCleanupDatabaseClient` is
 * narrowed to the exact two statements the cleanup path issues, and widening it
 * to carry a reporting query would blur what that contract is for.
 */
export async function listRecentRemovals(
  windowHours = 24,
  client?: {
    from(table: "link_check_results"): {
      select(columns: string): {
        gte(
          column: "auto_nulled_at",
          value: string,
        ): {
          order(
            column: "auto_nulled_at",
            options: { ascending: boolean },
          ): QueryResult<
            | {
                field: string;
                url: string;
                auto_nulled_at: string;
                brands:
                  { name: string | null } | { name: string | null }[] | null;
              }[]
            | null
          >;
        };
      };
    };
  },
  now: () => Date = () => new Date(),
): Promise<LinkCleanupRecentRemoval[]> {
  const db =
    client ??
    (createServiceClient() as unknown as NonNullable<
      Parameters<typeof listRecentRemovals>[1]
    >);
  const since = new Date(
    now().getTime() - windowHours * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await db
    .from("link_check_results")
    .select("field, url, auto_nulled_at, brands(name)")
    .gte("auto_nulled_at", since)
    .order("auto_nulled_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load recent link removals: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    brandName: Array.isArray(row.brands)
      ? (row.brands[0]?.name ?? null)
      : (row.brands?.name ?? null),
    field: row.field,
    removedAt: row.auto_nulled_at,
    url: row.url,
  }));
}

/**
 * The database boundary, narrowed to exactly the two statements this service
 * issues. Injected only by tests; production always uses the service client,
 * which is untyped and therefore cast at the single call site below. Same seam
 * shape as `LinkHealthDatabaseClient` — `scripts/check-test-boundaries.mjs`
 * forbids module-mocking `@/lib/supabase/*`, so the contract lives in the
 * signature instead.
 */
export interface LinkCleanupDatabaseClient {
  from(table: "link_check_results"): {
    select(columns: string): {
      eq(
        column: "cleanup_required",
        value: true,
      ): {
        is(
          column: "auto_nulled_at",
          value: null,
        ): {
          or(filter: string): QueryResult<CandidateRow[] | null>;
        };
      };
    };
    update(values: { auto_nulled_at: string }): {
      eq(column: "id", value: string): QueryResult<null>;
    };
  };
}

/**
 * Structural signature of `updateBrand`, narrowed to the part this service
 * reads. Test seam only — see `LinkCleanupDatabaseClient`.
 */
export type BrandWriter = (
  id: string,
  data: BrandWriteInput,
  actor: BrandWriteActor,
) => Promise<{ skipped: SkippedBrandField[] }>;

export interface LinkCleanupOptions {
  dryRun?: boolean;
  /** Injected only by tests; production always uses the service client. */
  client?: LinkCleanupDatabaseClient;
  /** Injected only by tests; production always uses `updateBrand`. */
  writeBrand?: BrandWriter;
  /** Injected only by tests; production always uses the wall clock. */
  now?: () => Date;
  /** Injected only by tests; production always uses the real network. */
  fetchFn?: typeof fetch;
}

/**
 * Re-check a URL against the live network immediately before removing it.
 *
 * The stored verdict is a claim made by an earlier run, and this is the one
 * operation in the system that destroys user-facing data on the strength of it.
 * Two ways it can be wrong: the row can be days old and the site has recovered,
 * or the checker itself can be mistaken — which is not hypothetical. A live
 * sample of the first nine candidates found seven answering `HEAD 404` and
 * `GET 200`, because `checkUrl` treated a HEAD 404 as final. That is fixed in
 * link-health.ts, but a detector bug must not be able to reach a destructive
 * write again, and this check does not depend on that fix being correct.
 *
 * Confirmation uses the same `checkUrl` a real check would, so the two can
 * never drift apart in method, User-Agent, or redirect handling.
 */
async function confirmStillDead(
  url: string,
  fetchFn: typeof fetch,
  expectedReason: "dns" | "http",
): Promise<{ dead: boolean; statusCode: number | null }> {
  try {
    const { status, statusCode, failureReason } = await checkUrl(url, fetchFn);
    return {
      dead:
        status === "broken" &&
        (expectedReason === "dns"
          ? failureReason === "dns" && statusCode === null
          : statusCode !== null && AUTO_NULL_STATUS_CODES.has(statusCode)),
      statusCode,
    };
  } catch {
    // An error here is our own network, not evidence about the URL. Refuse.
    return { dead: false, statusCode: null };
  }
}

const CANDIDATE_SELECT =
  "id, brand_id, field, url, last_status_code, failure_reason, brands(name)";

/**
 * Inverted `LINK_FIELD_TO_COLUMN` rather than a second hand-written switch.
 * `link_check_results.field` stores the snake_case column; `BrandWriteInput`
 * keys are camelCase. The registry already owns that mapping for both the
 * purchase channels and the three socials, so re-listing it here would be a
 * second source of truth that silently rots when a channel is added.
 */
const LINK_COLUMN_TO_FIELD: Partial<Record<string, LinkField>> =
  Object.fromEntries(
    Object.entries(LINK_FIELD_TO_COLUMN).map(([camel, column]) => [
      column as LinkColumn,
      camel as LinkField,
    ]),
  );

/**
 * A one-field null patch, or null when the column is not a brand link field.
 *
 * `hero_image_url` reaches this table too (the link checker probes it), and it
 * is not a link column — clearing a hero image is an images-pipeline decision,
 * not a dead-link one. Anything unrecognized is reported, never thrown on: one
 * unexpected `field` value must not abort a whole cleanup run.
 */
function buildNullPatch(column: string): BrandWriteInput | null {
  const camelField = LINK_COLUMN_TO_FIELD[column];
  if (!camelField) return null;
  const patch: BrandWriteInput = {};
  patch[camelField] = null;
  return patch;
}

function brandName(row: CandidateRow): string | null {
  if (!row.brands) return null;
  const embedded = Array.isArray(row.brands) ? row.brands[0] : row.brands;
  return embedded?.name ?? null;
}

/**
 * Nulls brand links the health checker has proven dead.
 *
 * Writes as `source: "enriched"` on purpose: that actor makes
 * `resolveWritablePatch` skip any field an owner authored, returning it in
 * `skipped` with `protected:owner`. An owner who typed a URL that currently
 * 404s keeps it — they may be mid-migration, and this path has no approval
 * queue to catch a bad automatic call.
 *
 * `auto_nulled_at` is stamped ONLY after a confirmed write. A skipped field is
 * still live on the brand, so its row must stay a candidate for the next run.
 */
export async function cleanupDeadLinks(
  options: LinkCleanupOptions = {},
): Promise<LinkCleanupResult> {
  return auditedCall(
    { provider: "brands", operation: "cleanupDeadLinks", kind: "service" },
    async (): Promise<LinkCleanupResult> => {
      const dryRun = options.dryRun === true;
      const now = options.now ?? (() => new Date());
      const writeBrand: BrandWriter = options.writeBrand ?? updateBrand;
      const fetchFn = options.fetchFn ?? fetch;
      const db =
        options.client ??
        (createServiceClient() as unknown as LinkCleanupDatabaseClient);

      const { data, error } = await db
        .from("link_check_results")
        .select(CANDIDATE_SELECT)
        .eq("cleanup_required", true)
        .is("auto_nulled_at", null)
        .or(
          "and(last_status_code.in.(404,410),failure_reason.is.null),and(last_status_code.in.(404,410),failure_reason.eq.http),and(last_status_code.is.null,failure_reason.eq.dns)",
        );

      if (error) {
        throw new Error(
          `Failed to load link_check_results cleanup candidates: ${error.message}`,
        );
      }

      const rows = data ?? [];
      const applied: LinkCleanupApplied[] = [];
      const skipped: LinkCleanupSkipped[] = [];

      for (const row of rows) {
        const base = {
          brandId: row.brand_id,
          field: row.field,
          url: row.url,
        };

        // Defence in depth behind the `.or()` filter above: if the query is
        // ever loosened, a transient failure must still not be auto-nulled.
        const statusCode = row.last_status_code;
        const isDnsFailure =
          statusCode === null &&
          row.failure_reason !== null &&
          AUTO_NULL_FAILURE_REASONS.has(row.failure_reason);
        const isHttpFailure =
          (row.failure_reason === null || row.failure_reason === "http") &&
          statusCode !== null &&
          AUTO_NULL_STATUS_CODES.has(statusCode);
        if (!isDnsFailure && !isHttpFailure) {
          skipped.push({ ...base, reason: "status_not_auto_nullable" });
          continue;
        }

        const patch = buildNullPatch(row.field);
        if (!patch) {
          skipped.push({ ...base, reason: "unsupported_field" });
          continue;
        }

        // Confirm against the live network before trusting the stored verdict.
        // This runs in dry-run too: a dry run whose job is to preview
        // destruction is worthless if it previews a different decision than the
        // real one would make.
        const confirmation = await confirmStillDead(
          row.url,
          fetchFn,
          isDnsFailure ? "dns" : "http",
        );
        if (!confirmation.dead) {
          skipped.push({
            ...base,
            reason:
              confirmation.statusCode === null
                ? "recheck_inconclusive"
                : `recheck_alive:${confirmation.statusCode}`,
          });
          continue;
        }

        if (dryRun) {
          applied.push({ ...base, brandName: brandName(row), statusCode });
          continue;
        }

        // Per-row isolation: one brand can carry several dead links and one
        // failing write must not strand the rest of the run.
        try {
          const result = await writeBrand(row.brand_id, patch, {
            source: "enriched",
          });
          // `resolveWritablePatch` reports skips keyed by the snake_case column,
          // which is exactly what `link_check_results.field` stores.
          const blocked = result.skipped.find(
            (entry) => entry.field === row.field,
          );
          if (blocked) {
            skipped.push({ ...base, reason: blocked.reason });
            continue;
          }

          const { error: stampError } = await db
            .from("link_check_results")
            .update({ auto_nulled_at: now().toISOString() })
            .eq("id", row.id);
          if (stampError) {
            skipped.push({
              ...base,
              reason: `stamp_failed:${stampError.message}`,
            });
            continue;
          }

          applied.push({ ...base, brandName: brandName(row), statusCode });
        } catch (writeError) {
          skipped.push({
            ...base,
            reason: `write_failed:${describeError(writeError)}`,
          });
        }
      }

      return { applied, skipped, scanned: rows.length };
    },
    { summary: { dryRun: options.dryRun === true } },
  );
}

const TAIPEI_TIME_ZONE = "Asia/Taipei";

function taipeiDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: TAIPEI_TIME_ZONE,
    year: "numeric",
  }).format(now);
}

/**
 * Report-only categories, and where each one is tracked. Carried in the Slack
 * message so a reader sees the whole picture: what changed, and what was left
 * alone on purpose. Without this the notification reads as "9 links removed"
 * and silently implies the queue is empty.
 */
const REPORT_ONLY_TICKETS = [
  "DEV-1439 — 405/402 are classified broken rather than blocked, inflating the queue",
] as const;

function removalEvidence(statusCode: number | null): string {
  return statusCode === null ? "DNS failure" : `HTTP ${statusCode}`;
}

/**
 * The nightly Slack message for a cleanup run.
 *
 * Pure by construction: it takes the run's own result plus the recent-removal
 * window and returns the notification, so the cron route only has to post it.
 * The adapter is imported as a TYPE only — a service must not reach an adapter
 * at runtime (RULES file-ownership table).
 */
export function buildLinkCleanupNotification(
  result: LinkCleanupResult,
  applied: boolean,
  recent: readonly LinkCleanupRecentRemoval[],
): AgentNotification {
  const summary = [
    applied
      ? `Removed ${result.applied.length} dead brand ${result.applied.length === 1 ? "link" : "links"} (HTTP 404/410 or sustained DNS failures).`
      : `Dry run: ${result.applied.length} dead ${result.applied.length === 1 ? "link" : "links"} would be removed (HTTP 404/410 or sustained DNS failures).`,
    `Scanned ${result.scanned} flagged ${result.scanned === 1 ? "row" : "rows"}; ${result.skipped.length} skipped.`,
  ];

  const workDone =
    result.applied.length > 0
      ? result.applied.map(
          (entry) =>
            `${entry.brandName ?? entry.brandId} · ${entry.field} · ${removalEvidence(entry.statusCode)} · ${entry.url}`,
        )
      : // Nothing to do this run is the steady state, and an empty message reads
        // as "no dead links" when the truth may be "removed an hour ago".
        recent.map(
          (entry) =>
            `earlier today: ${entry.brandName ?? "(unknown brand)"} · ${entry.field} · ${entry.url}`,
        );

  const details = [
    ...result.skipped.map(
      (entry) => `skipped ${entry.field} (${entry.reason}) · ${entry.url}`,
    ),
    ...REPORT_ONLY_TICKETS.map((ticket) => `report-only: ${ticket}`),
  ];

  return {
    agent: "Link Cleanup",
    date: taipeiDate(),
    details,
    // A skip is not a failure — an owner-authored link is protected by policy
    // and staying out of it is the correct outcome. But it is the one thing a
    // reader has to act on, so it lifts the status above plain success.
    status: result.skipped.length > 0 ? "needs_attention" : "success",
    summary,
    workDone,
  };
}
