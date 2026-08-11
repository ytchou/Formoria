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
import { checkUrl } from "./link-health";

/**
 * The ONLY status codes that authorize an automatic null.
 *
 * 404 and 410 are the two responses that mean the resource is gone as a fact
 * about the origin, not as a fact about this request: 404 "not here", 410
 * "deliberately removed". Everything else the link checker can record is
 * transient or ambiguous and is deliberately excluded:
 *   - 5xx: the origin is broken right now, not the URL. A shop that 500s during
 *     a deploy would lose its purchase link permanently.
 *   - 402 / 405: a payment wall or a method the origin refuses for HEAD/GET
 *     probes. The page is usually still there for a real visitor.
 *   - `last_status_code IS NULL`: no HTTP response at all (DNS failure, TLS
 *     error, timeout). That is a statement about the network path, and our own
 *     checker's egress is part of that path.
 * The asymmetry is intentional. A missed cleanup costs one stale link in an
 * admin report; a false null costs a brand real outbound traffic and can only
 * be repaired by hand. When in doubt, leave the link alone.
 */
export const AUTO_NULL_STATUS_CODES: ReadonlySet<number> = new Set([404, 410]);

export type LinkCleanupApplied = {
  brandId: string;
  brandName: string | null;
  field: string;
  url: string;
  statusCode: number;
};

export type LinkCleanupSkipped = {
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
  /** PostgREST returns an embedded to-one either as an object or a 1-element array. */
  brands: { name: string | null } | { name: string | null }[] | null;
};

type QueryResult<T> = Promise<{ data: T; error: { message: string } | null }>;

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
          in(
            column: "last_status_code",
            values: number[],
          ): QueryResult<CandidateRow[] | null>;
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
): Promise<{ dead: boolean; statusCode: number | null }> {
  try {
    const { status, statusCode } = await checkUrl(url, fetchFn);
    return {
      dead:
        status === "broken" &&
        statusCode !== null &&
        AUTO_NULL_STATUS_CODES.has(statusCode),
      statusCode,
    };
  } catch {
    // An error here is our own network, not evidence about the URL. Refuse.
    return { dead: false, statusCode: null };
  }
}

const CANDIDATE_SELECT =
  "id, brand_id, field, url, last_status_code, brands(name)";

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
        .in("last_status_code", [...AUTO_NULL_STATUS_CODES]);

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

        // Defence in depth behind the `.in()` filter above: if the query is
        // ever loosened, a transient failure must still not be auto-nulled.
        const statusCode = row.last_status_code;
        if (statusCode === null || !AUTO_NULL_STATUS_CODES.has(statusCode)) {
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
        const confirmation = await confirmStillDead(row.url, fetchFn);
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
