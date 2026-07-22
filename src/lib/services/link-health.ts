import { createServiceClient } from "@/lib/supabase/server";

export type LinkStatus = "ok" | "broken" | "blocked";

export interface LinkHealthOptions {
  dryRun?: boolean;
  runIdentity?: string;
  workflowAttempt?: number;
  fetchFn?: typeof fetch;
  now?: () => Date;
}

interface LinkHealthFinding {
  brandId: string;
  field: CheckedField;
  url: string;
}

export interface LinkHealthSummary {
  checked: number;
  ok: number;
  broken: number;
  blocked: number;
  cleanupRequired: LinkHealthFinding[];
  heroBroken: { brandId: string; url: string }[];
  heroExternal: { brandId: string; url: string }[];
  failingRows: (LinkHealthFinding & {
    statusCode: number | null;
    failureDates: string[];
    consecutiveFailures: number;
  })[];
  severity: "ok" | "warning" | "critical";
}

type CheckedField =
  "purchase_website" | "purchase_pinkoi" | "purchase_shopee" | "hero_image_url";

type BrandRow = { id: string } & Record<CheckedField, string | null>;

type ExistingRow = {
  id: string;
  brand_id: string;
  field: string;
  url: string;
  consecutive_failures: number;
  failure_dates: string[] | null;
  last_ok_at: string | null;
  auto_nulled_at: string | null;
  cleanup_required_at: string | null;
};

type LedgerClaim = {
  claimed: boolean;
  replay?: boolean;
  result?: LinkHealthSummary | null;
  run?: { status: string };
};

type LedgerResult = LedgerClaim | boolean;

type QueryResult<T> = Promise<{ data: T; error: { message: string } | null }>;

interface LinkHealthDatabaseClient {
  from(table: "brands"): {
    select(columns: string): {
      eq(column: "status", value: "approved"): QueryResult<BrandRow[] | null>;
    };
  };
  from(table: "link_check_results"): {
    select(columns: string): {
      in(
        column: "brand_id",
        values: string[],
      ): QueryResult<ExistingRow[] | null>;
    };
    upsert(
      rows: Record<string, unknown>[],
      options: { onConflict: "brand_id,field" },
    ): QueryResult<null>;
  };
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): QueryResult<LedgerResult | LedgerClaim[] | null>;
}

const CHECKED_FIELDS: CheckedField[] = [
  "purchase_website",
  "purchase_pinkoi",
  "purchase_shopee",
  "hero_image_url",
];

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT_MS = 10_000;
const CONCURRENCY = 5;
const RETRY_ON = new Set([405, 501]);
const SAFE_RUN_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const MAX_WORKFLOW_ATTEMPT = 1_000_000;

// These names are the public contract created by the health-agent foundation migration.
export const RUN_LEDGER_RPC_NAMES = {
  claim: "claim_health_agent_run",
  complete: "complete_health_agent_run",
  fail: "fail_health_agent_run",
} as const;

function isSupabaseStorageUrl(url: string): boolean {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (supabaseUrl && url.startsWith(`${supabaseUrl}/storage/`)) return true;
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.toLowerCase().endsWith(".supabase.co") &&
      parsed.pathname.startsWith("/storage/")
    );
  } catch {
    return false;
  }
}

function getTaipeiDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Taipei",
    year: "numeric",
  }).formatToParts(date);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function rpcRow(
  data: LedgerResult | LedgerClaim[] | null,
): LedgerResult | null {
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

async function runLedgerRpc(
  db: LinkHealthDatabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<LedgerResult | null> {
  const { data, error } = await db.rpc(name, args);
  if (error)
    throw new Error(`Link health run ledger ${name} failed: ${error.message}`);
  return rpcRow(data);
}

export async function checkUrl(
  url: string,
  fetchFn: typeof fetch,
): Promise<{ status: LinkStatus; statusCode: number | null }> {
  const request = async (method: "HEAD" | "GET") => {
    const response = await fetchFn(url, {
      method,
      headers: { "User-Agent": BROWSER_UA },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.status;
  };

  let headStatus: number;
  try {
    headStatus = await request("HEAD");
  } catch {
    return { status: "broken", statusCode: null };
  }

  if (headStatus >= 200 && headStatus < 400)
    return { status: "ok", statusCode: headStatus };
  if (headStatus === 403 || headStatus === 429)
    return { status: "blocked", statusCode: headStatus };
  if (headStatus === 404 || headStatus === 410)
    return { status: "broken", statusCode: headStatus };

  if (RETRY_ON.has(headStatus)) {
    let getStatus: number;
    try {
      getStatus = await request("GET");
    } catch {
      return { status: "broken", statusCode: null };
    }

    if (getStatus >= 200 && getStatus < 400)
      return { status: "ok", statusCode: getStatus };
    if (getStatus === 403 || getStatus === 429)
      return { status: "blocked", statusCode: getStatus };
    if (getStatus === 404 || getStatus === 410) {
      return { status: "broken", statusCode: getStatus };
    }
    return { status: "broken", statusCode: getStatus };
  }

  return { status: "broken", statusCode: headStatus };
}

async function runConcurrent<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const taskIndex = index++;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 200));
      results[taskIndex] = await tasks[taskIndex]();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()),
  );
  return results;
}

export async function runLinkHealthCheck(
  options: LinkHealthOptions = {},
): Promise<LinkHealthSummary> {
  const dryRun = options.dryRun ?? false;
  if (
    !dryRun &&
    (!options.runIdentity || !SAFE_RUN_IDENTITY.test(options.runIdentity))
  ) {
    throw new Error("runIdentity is required for live link health checks");
  }
  if (
    options.workflowAttempt !== undefined &&
    (!Number.isSafeInteger(options.workflowAttempt) ||
      options.workflowAttempt <= 0 ||
      options.workflowAttempt > MAX_WORKFLOW_ATTEMPT)
  ) {
    throw new Error("workflowAttempt must be a positive bounded integer");
  }

  const nowDate = options.now?.() ?? new Date();
  const now = nowDate.toISOString();
  const logicalDate = getTaipeiDate(nowDate);
  const runIdentity = options.runIdentity ?? null;
  const fetchFn = options.fetchFn ?? fetch;
  const db = createServiceClient() as unknown as LinkHealthDatabaseClient;
  const ledgerArgs = {
    p_routine: "link-checker",
    p_logical_date: logicalDate,
    p_requested_run_id: runIdentity,
    p_workflow_attempt: options.workflowAttempt ?? 1,
  };
  let claimed = false;

  if (!dryRun) {
    const claimResult = await runLedgerRpc(db, RUN_LEDGER_RPC_NAMES.claim, {
      ...ledgerArgs,
      p_dry_run: false,
    });
    const claim = typeof claimResult === "boolean" ? null : claimResult;
    if (claim?.claimed === false && claim.replay === true && claim.result) {
      return claim.result;
    }
    if (claim?.claimed !== true) {
      throw new Error("Link health run is already in progress");
    }
    claimed = true;
  }

  try {
    const { data: brands, error: brandsError } = await db
      .from("brands")
      .select(
        "id, purchase_website, purchase_pinkoi, purchase_shopee, hero_image_url",
      )
      .eq("status", "approved");
    if (brandsError)
      throw new Error(`Failed to load brands: ${brandsError.message}`);

    const brandList = brands ?? [];
    const brandIds = brandList.map((brand) => brand.id);
    const urlTasks: { brandId: string; field: CheckedField; url: string }[] =
      [];
    for (const brand of brandList) {
      for (const field of CHECKED_FIELDS) {
        const url = brand[field];
        if (url) urlTasks.push({ brandId: brand.id, field, url });
      }
    }

    const existingRows: ExistingRow[] = [];
    if (brandIds.length > 0) {
      const { data, error } = await db
        .from("link_check_results")
        .select(
          "id, brand_id, field, url, consecutive_failures, failure_dates, last_ok_at, auto_nulled_at, cleanup_required_at",
        )
        .in("brand_id", brandIds);
      if (error)
        throw new Error(`Failed to load link_check_results: ${error.message}`);
      existingRows.push(...(data ?? []));
    }

    const existingMap = new Map(
      existingRows.map((row) => [`${row.brand_id}:${row.field}`, row]),
    );
    const checkResults = await runConcurrent(
      urlTasks.map((task) => async () => ({
        ...task,
        ...(await checkUrl(task.url, fetchFn)),
      })),
      CONCURRENCY,
    );

    const upsertRows: Record<string, unknown>[] = [];
    const cleanupRequired: LinkHealthSummary["cleanupRequired"] = [];
    const failingRows: LinkHealthSummary["failingRows"] = [];
    const heroBroken: LinkHealthSummary["heroBroken"] = [];
    const heroExternal: LinkHealthSummary["heroExternal"] = [];
    let ok = 0;
    let broken = 0;
    let blocked = 0;

    for (const result of checkResults) {
      const existing = existingMap.get(`${result.brandId}:${result.field}`);
      const urlChanged = existing !== undefined && existing.url !== result.url;
      const priorDates = urlChanged ? [] : (existing?.failure_dates ?? []);
      let failureDates = [...new Set(priorDates)];
      let consecutiveFailures = urlChanged
        ? 0
        : (existing?.consecutive_failures ?? 0);
      let lastOkAt = urlChanged ? null : (existing?.last_ok_at ?? null);
      let cleanupRequiredAt = urlChanged
        ? null
        : (existing?.cleanup_required_at ?? null);

      if (result.status === "ok") {
        ok++;
        consecutiveFailures = 0;
        lastOkAt = now;
      } else if (result.status === "blocked") {
        blocked++;
      } else {
        broken++;
        const alreadyRecordedToday = failureDates.includes(logicalDate);
        failureDates = alreadyRecordedToday
          ? failureDates
          : [...failureDates, logicalDate];
        consecutiveFailures = alreadyRecordedToday
          ? consecutiveFailures
          : urlChanged || !existing
            ? 1
            : existing.consecutive_failures + 1;
        const deterministicStorageFailure =
          isSupabaseStorageUrl(result.url) &&
          (result.statusCode === 404 || result.statusCode === 410);
        if (
          !cleanupRequiredAt &&
          (failureDates.length >= 3 || deterministicStorageFailure)
        ) {
          cleanupRequiredAt = now;
        }

        const finding: LinkHealthFinding = {
          brandId: result.brandId,
          field: result.field,
          url: result.url,
        };
        failingRows.push({
          ...finding,
          statusCode: result.statusCode,
          failureDates,
          consecutiveFailures,
        });

        if (result.field === "hero_image_url") {
          if (isSupabaseStorageUrl(result.url)) {
            heroBroken.push({ brandId: result.brandId, url: result.url });
          } else {
            heroExternal.push({ brandId: result.brandId, url: result.url });
          }
        }
      }

      if (cleanupRequiredAt) {
        cleanupRequired.push({
          brandId: result.brandId,
          field: result.field,
          url: result.url,
        });
      }

      upsertRows.push({
        brand_id: result.brandId,
        field: result.field,
        url: result.url,
        last_status_code: result.statusCode,
        last_ok_at: lastOkAt,
        last_checked_at: now,
        consecutive_failures: consecutiveFailures,
        failure_dates: failureDates,
        distinct_failure_days: failureDates.length,
        cleanup_required: cleanupRequiredAt !== null,
        cleanup_required_at: cleanupRequiredAt,
      });
    }

    if (!dryRun && upsertRows.length > 0) {
      const { error } = await db
        .from("link_check_results")
        .upsert(upsertRows, { onConflict: "brand_id,field" });
      if (error)
        throw new Error(
          `Failed to upsert link_check_results: ${error.message}`,
        );
    }

    const summary: LinkHealthSummary = {
      checked: urlTasks.length,
      ok,
      broken,
      blocked,
      cleanupRequired,
      heroBroken,
      heroExternal,
      failingRows,
      severity:
        heroBroken.length > 0
          ? "critical"
          : failingRows.length > 0
            ? "warning"
            : "ok",
    };

    if (!dryRun) {
      const completed = await runLedgerRpc(db, RUN_LEDGER_RPC_NAMES.complete, {
        ...ledgerArgs,
        p_result: summary,
      });
      if (completed !== true) {
        throw new Error("Link health run ledger completion did not transition");
      }
    }
    return summary;
  } catch (error) {
    if (claimed) {
      try {
        const failed = await runLedgerRpc(db, RUN_LEDGER_RPC_NAMES.fail, {
          ...ledgerArgs,
          p_error:
            error instanceof Error
              ? error.message
              : "Unknown link health failure",
          p_result: null,
        });
        if (failed !== true) {
          throw new Error("Link health run ledger failure did not transition");
        }
      } catch (ledgerError) {
        throw new AggregateError(
          [error, ledgerError],
          "Link health failed and its ledger failure could not be persisted",
        );
      }
    }
    throw error;
  }
}
