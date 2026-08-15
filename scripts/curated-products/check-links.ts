import { auditedCall } from "@/lib/audit";
import { requestPublicBrandRevalidation } from "@/lib/cache/revalidate-client";
import { mapWithConcurrency } from "@/lib/services/_shared/concurrency";
import { createServiceClient } from "@/lib/supabase/service";
import { isPrivateUrl } from "@/lib/url";

import {
  assertRevalidationConfigured,
  fetchAllRows,
  parseBrandOption,
} from "./shared";

/**
 * Curated-product link health and review-due report (DEV-1404).
 *
 *   pnpm exec tsx --env-file=.env.local scripts/curated-products/check-links.ts
 *   pnpm exec tsx --env-file=.env.local scripts/curated-products/check-links.ts --apply
 *   pnpm exec tsx --env-file=.env.local scripts/curated-products/check-links.ts --brand=hanchor
 *   pnpm exec tsx --env-file=.env.local scripts/curated-products/check-links.ts --review-only
 *
 * TWO REPORTS, ONE RUN:
 *   1. link health — does each `official_url` still resolve;
 *   2. review due  — which products are past their `review_due_at`.
 *
 * REVIEW CADENCE. A published product is re-reviewed QUARTERLY for its first
 * six months, then SEMIANNUALLY if it has been stable (no correction, no link
 * state change). That schedule is only the floor: an IMMEDIATE review is
 * triggered whenever the model, the URL, a specification, the image, or the
 * official route changes, because each of those invalidates something an editor
 * asserted in the rationale. `review_due_at` is set by the write path that
 * creates or edits the product; this script never writes it — it only reports
 * the rows that have gone past it.
 *
 * READ SCOPE. Only `published` and `needs_review` rows are read
 * (CURATED_LINK_READ_LIFECYCLES). `candidate` is excluded on purpose: nothing
 * renders a candidate, so probing one buys an `external_call_audit` row per run
 * for no reader, machine-authors `link_state` before an editor has looked at
 * the row, and — worst — puts its brand slug into the revalidation set, so a
 * PUBLIC brand page is rebuilt for a change that cannot appear on it and a
 * revalidation failure fails the whole run. `retired` stays out for the same
 * reason it always did. The allow-list is positive rather than a `neq` so a new
 * lifecycle value defaults to NOT being probed.
 *
 * LINK HEALTH IS NOT AVAILABILITY. A 200 proves the page resolves. It never
 * proves the product is in stock, still priced the same, or still sold. Nothing
 * here records stock, price, inventory, or availability; those are commercial
 * facts with a freshness obligation nothing in this product can honour, which
 * is exactly why `curated_products` has no column for them.
 *
 * A BOT CHALLENGE IS NOT A DEAD LINK. 402/403/405/429 are recorded as NO
 * verdict — the stored `link_state` is left untouched and the run summary
 * counts them — because a Cloudflare-fronted origin refuses a scripted HEAD
 * while serving a real visitor perfectly. `link_state` has no `blocked` value
 * and its CHECK constraint is already applied to the live database.
 *
 * --apply FAILS LOUDLY. The revalidation credentials are checked BEFORE the
 * first write and a failed revalidation exits non-zero: a cron that reports
 * success while a brand page keeps serving a live CTA to a URL just proven dead
 * is the failure this script exists to prevent.
 *
 * WRITE SCOPE. The updater writes `link_state` and `link_checked_at` and
 * nothing else (CURATED_LINK_WRITE_COLUMNS). Every other column on the table is
 * authored — name, rationale, official_url, lifecycle, images, notes — and a
 * health run that touched one would silently overwrite editorial copy with
 * whatever the last read happened to see.
 */

/** The `curated_products.link_state` CHECK values this script can produce. */
export type CuratedLinkState = "ok" | "redirected" | "broken";

/**
 * The ONLY columns this script writes. Exported so the test can assert the set
 * rather than trusting a reader to notice a third key appearing in the update
 * literal below.
 */
export const CURATED_LINK_WRITE_COLUMNS = [
  "link_state",
  "link_checked_at",
] as const;

/**
 * What the fetching shell observed.
 *
 * `requestedUrl` is carried ALONGSIDE `resolvedUrl` on purpose: with only the
 * final URL the classifier cannot tell a redirect from a direct hit, and every
 * followed redirect would silently read as a healthy link.
 *
 * `status` is null when there was no HTTP response at all (DNS, TLS, timeout,
 * reset) and `resolvedUrl` is null when the request never landed anywhere.
 */
export type LinkProbe = {
  requestedUrl: string;
  resolvedUrl: string | null;
  status: number | null;
};

/**
 * Statuses that are NOT evidence about the link.
 *
 * A Cloudflare-fronted origin answers a scripted HEAD with 403, and a rate
 * limiter answers 429; both serve the page perfectly to a real visitor.
 * src/lib/services/link-health.ts already treats this set as `blocked` for the
 * same reason. Recording them as `broken` would drop the working call-to-action
 * from every product on that origin, on every run.
 *
 * `curated_products.link_state` has no `blocked` value and its CHECK constraint
 * is already applied to the live database, so the verdict here is "no verdict":
 * the existing `link_state` is left exactly as it was and the run summary
 * surfaces the count for a human.
 */
const BLOCKED_STATUSES = new Set([402, 403, 405, 429]);

export type LinkClassification = {
  /** `null` when the probe proves nothing — leave the stored state alone. */
  linkState: CuratedLinkState | null;
  /** True when a bot challenge or rate limit answered instead of the origin. */
  blocked: boolean;
  status: number | null;
  requestedUrl: string;
  resolvedUrl: string | null;
  /** Set only for `redirected`, so an editor can see where the URL moved to. */
  redirectedTo: string | null;
  /** ISO timestamp destined for `link_checked_at`. */
  checkedAt: string;
};

/**
 * Comparable identity of a URL: host without `www.`, plus the path without a
 * trailing slash. Scheme, port, case, and the `www.` prefix are normalisation
 * noise — an origin upgrading http to https or adding a trailing slash has not
 * moved the product, and flagging that as a redirect would put every canonical
 * host rule in the review queue on the first run.
 *
 * Query and fragment are deliberately excluded: origins append tracking and
 * locale parameters on redirect, and none of that changes which page landed.
 */
function comparableTarget(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${host}${path}`;
  } catch {
    return null;
  }
}

/**
 * PURE. No fetch, no clock beyond `now`, no database — the whole rule set that
 * decides a product's `link_state`, testable without a network.
 *
 * 2xx/3xx are the resolving classes; everything else (4xx, 5xx, and a null
 * status from a connection failure) is `broken`. Within the resolving classes
 * the verdict is decided by WHERE the request landed, not by which status code
 * carried it there — a shell that follows redirects reports a final 200, and a
 * shell that does not reports the 301. Both must reach the same answer.
 */
export function classify(
  probe: LinkProbe,
  now: () => Date = () => new Date(),
): LinkClassification {
  const { requestedUrl, resolvedUrl, status } = probe;
  const base = {
    status,
    requestedUrl,
    resolvedUrl,
    blocked: false,
    checkedAt: now().toISOString(),
  };

  if (status !== null && BLOCKED_STATUSES.has(status)) {
    return { ...base, blocked: true, linkState: null, redirectedTo: null };
  }

  const resolves = status !== null && status >= 200 && status < 400;
  if (!resolves) {
    return { ...base, linkState: "broken", redirectedTo: null };
  }

  const requestedTarget = comparableTarget(requestedUrl);
  const resolvedTarget =
    resolvedUrl === null ? null : comparableTarget(resolvedUrl);

  // An unparseable or absent landing URL is treated as "landed where we asked":
  // a probe that answered 2xx/3xx did reach something, and inventing a redirect
  // out of a missing field would flag healthy links for review.
  if (resolvedTarget === null || resolvedTarget === requestedTarget) {
    return { ...base, linkState: "ok", redirectedTo: null };
  }

  // The product KEEPS its call-to-action: the destination answered, it is just
  // no longer the page the editor cited. That is a review task, not a removal.
  return { ...base, linkState: "redirected", redirectedTo: resolvedUrl };
}

/** One row of the review-due report's input, as read from `curated_products`. */
export type ReviewDueCandidate = {
  id: string;
  brandId: string;
  brandSlug: string | null;
  key: string;
  nameZh: string;
  lifecycle: string;
  linkState: string;
  reviewDueAt: string | null;
};

export type ReviewDueProduct = ReviewDueCandidate & {
  reviewDueAt: string;
  daysOverdue: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * PURE. Products whose authored `review_due_at` has already passed, most
 * overdue first — the report is a work queue, so the oldest debt leads.
 *
 * A row with no `review_due_at` is NOT overdue. It was never scheduled, which
 * is an authoring gap tracked at sync time; folding it in here would bury the
 * genuinely overdue rows under every unscheduled candidate.
 */
export function selectReviewDue(
  candidates: readonly ReviewDueCandidate[],
  now: Date = new Date(),
): ReviewDueProduct[] {
  const nowMs = now.getTime();

  return candidates
    .flatMap((candidate) => {
      if (!candidate.reviewDueAt) return [];
      const dueMs = Date.parse(candidate.reviewDueAt);
      // A due date exactly at `now` is not yet past: the boundary belongs to
      // the future side, or a quarterly cadence reports a day early.
      if (Number.isNaN(dueMs) || dueMs >= nowMs) return [];
      return [
        {
          ...candidate,
          reviewDueAt: candidate.reviewDueAt,
          daysOverdue: Math.floor((nowMs - dueMs) / MS_PER_DAY),
        },
      ];
    })
    .sort(
      (a, b) =>
        Date.parse(a.reviewDueAt) - Date.parse(b.reviewDueAt) ||
        a.key.localeCompare(b.key),
    );
}

/* -------------------------------------------------------------------------- */
/* Fetching shell — everything below this line touches the network or the DB.  */
/* -------------------------------------------------------------------------- */

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT_MS = 10_000;
const CONCURRENCY = 5;

type CliOptions = {
  apply: boolean;
  brand: string | null;
  reviewOnly: boolean;
};

export function parseArgs(argv: string[]): CliOptions {
  return {
    apply: argv.includes("--apply"),
    brand: parseBrandOption(argv),
    reviewOnly: argv.includes("--review-only"),
  };
}

export type ProductRow = {
  id: string;
  brand_id: string;
  key: string;
  name_zh: string;
  lifecycle: string;
  official_url: string | null;
  link_state: string;
  review_due_at: string | null;
  brands: { slug: string | null } | { slug: string | null }[] | null;
  trail_slug?: string | null;
  curated_product_selections?:
    | { trail_slug: string; state?: string }[]
    | { trail_slug: string; state?: string }
    | null;
};

function brandSlugOf(row: ProductRow): string | null {
  const brands = Array.isArray(row.brands) ? row.brands[0] : row.brands;
  return brands?.slug ?? null;
}

export function trailSlugsOf(row: ProductRow): string[] {
  const embedded = row.curated_product_selections;
  const selections = embedded == null ? [] : Array.isArray(embedded) ? embedded : [embedded];
  const slugs = selections
    .filter((selection) => selection.state === undefined || selection.state === "active")
    .map((selection) => selection.trail_slug)
    .filter((slug): slug is string => Boolean(slug));
  if (row.trail_slug) slugs.push(row.trail_slug);
  return [...new Set(slugs)].sort();
}

/**
 * The ONLY lifecycles this script reads. A positive allow-list, not a `neq`:
 * every probe costs an `external_call_audit` row and can move `link_state`, so
 * a lifecycle nobody has thought about here must default to unprobed.
 *
 * `candidate` is excluded because no public surface renders it — probing one
 * spends a request per run for no reader, machine-authors a link verdict before
 * an editor has looked at the row, and drags its brand slug into the
 * revalidation set, rebuilding a public page for a change it cannot show.
 * Scoping the read also keeps candidates out of the review-due report, which
 * has no lifecycle filter of its own.
 */
export const CURATED_LINK_READ_LIFECYCLES = [
  "published",
  "needs_review",
] as const;

/**
 * The narrowest read shape `loadProducts` needs. Declared for the same reason
 * as `LinkStateWriter`: the unit test injects a recording double instead of
 * mocking the Supabase module, which scripts/check-test-boundaries.mjs forbids.
 */
export type ProductQuery = {
  in(column: string, values: readonly string[]): ProductQuery;
  eq(column: string, value: string): ProductQuery;
  order(column: string, options: { ascending: boolean }): ProductQuery;
  range(
    from: number,
    to: number,
  ): PromiseLike<{
    data: ProductRow[] | null;
    error: { message: string } | null;
  }>;
};

export type ProductReader = {
  from(table: string): { select(columns: string): ProductQuery };
};

/**
 * PAGED. A single `select()` stops at Supabase's default `db-max-rows` (1000)
 * with no error, so every product past the cap would silently never be probed
 * — and a run that checked 1000 of 2400 links still prints a clean summary.
 */
export async function loadProducts(
  brand: string | null,
  /** Seam for the unit test; the default is the real service client. */
  client?: ProductReader,
): Promise<ProductRow[]> {
  // The generic PostgREST builder is structurally wider than ProductReader;
  // this cast narrows it at the one call site rather than leaking generics.
  const supabase =
    client ?? (createServiceClient() as unknown as ProductReader);
  return fetchAllRows<ProductRow>("curated_products", (from, to) => {
    let query = supabase
      .from("curated_products")
      .select(
        "id, brand_id, key, name_zh, lifecycle, official_url, link_state, review_due_at, brands!inner(slug), curated_product_selections(trail_slug, state)",
      )
      .in("lifecycle", CURATED_LINK_READ_LIFECYCLES);
    if (brand) query = query.eq("brands.slug", brand);
    // A stable order is what makes paging correct: without it two pages can
    // repeat one row and skip another.
    return query.order("id", { ascending: true }).range(from, to);
  });
}

/**
 * One audited probe. The raw `fetch` lives inside `auditedCall` so the request,
 * the outcome, and the latency land in `external_call_audit` like every other
 * outbound call in this repo — a link verdict that flipped a published product
 * has to be replayable months later.
 *
 * HEAD first, GET on anything the origin may be refusing by method. SPA hosts
 * and PHP front controllers routinely answer `HEAD 404` and `GET 200`; the same
 * sample that motivated RETRY_ON in src/lib/services/link-health.ts found seven
 * live sites doing it, so a not-found verdict must survive a real visitor's
 * method before it is recorded.
 */
export async function probe(
  url: string,
  /** Seam for the unit test; the default is the global `fetch`. */
  fetchImpl: typeof fetch = fetch,
): Promise<LinkProbe> {
  if (isPrivateUrl(url)) {
    return { requestedUrl: url, resolvedUrl: null, status: null };
  }

  return auditedCall(
    { provider: "http", operation: "check_link", kind: "external" },
    async (ctx): Promise<LinkProbe> => {
      const request = async (method: "HEAD" | "GET") => {
        const response = await fetchImpl(url, {
          method,
          headers: { "User-Agent": BROWSER_UA },
          redirect: "follow",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        return {
          requestedUrl: url,
          // `response.url` is the URL AFTER redirects; it is the only reason the
          // classifier can tell a move from a direct hit.
          resolvedUrl: response.url || url,
          status: response.status,
        };
      };

      let result: LinkProbe;
      try {
        result = await request("HEAD");
        if (result.status !== null && result.status >= 400) {
          result = await request("GET");
        }
      } catch {
        try {
          result = await request("GET");
        } catch (error) {
          ctx.summary.error = error instanceof Error ? error.message : "failed";
          return { requestedUrl: url, resolvedUrl: null, status: null };
        }
      }

      ctx.summary.status = result.status;
      ctx.summary.resolvedUrl = result.resolvedUrl;
      return result;
    },
    {
      classify: (result) =>
        result.status === null
          ? "network_error"
          : result.status < 400
            ? "succeeded"
            : "failed",
    },
  );
}

export type LinkCheck = {
  row: ProductRow;
  classification: LinkClassification;
  /** True only when there IS a verdict and it differs from the stored state. */
  changed: boolean;
};

export type TrailLinkReport = {
  trailSlug: string;
  products: number;
  changed: number;
  blocked: number;
  brands: string[];
};

/** Groups link-health output by the editorial trail as well as its brand. */
export function groupLinkChecksByTrail(
  checks: readonly LinkCheck[],
): TrailLinkReport[] {
  const groups = new Map<string, TrailLinkReport>();
  for (const check of checks) {
    const slugs = trailSlugsOf(check.row);
    const keys = slugs.length > 0 ? slugs : ["unplaced"];
    for (const trailSlug of keys) {
      const report = groups.get(trailSlug) ?? {
        trailSlug,
        products: 0,
        changed: 0,
        blocked: 0,
        brands: [],
      };
      report.products += 1;
      if (check.changed) report.changed += 1;
      if (check.classification.blocked) report.blocked += 1;
      const brandSlug = brandSlugOf(check.row);
      if (brandSlug && !report.brands.includes(brandSlug)) report.brands.push(brandSlug);
      groups.set(trailSlug, report);
    }
  }
  return [...groups.values()]
    .map((report) => ({ ...report, brands: [...report.brands].sort() }))
    .sort((a, b) => a.trailSlug.localeCompare(b.trailSlug));
}

async function checkLinks(rows: readonly ProductRow[]): Promise<LinkCheck[]> {
  const checkable = rows.filter((row) => Boolean(row.official_url));
  return mapWithConcurrency(checkable, CONCURRENCY, async (row) => {
    const classification = classify(await probe(row.official_url!));
    return {
      row,
      classification,
      changed:
        classification.linkState !== null &&
        classification.linkState !== row.link_state,
    };
  });
}

/**
 * Writes the two link columns and NOTHING else. Row-at-a-time rather than an
 * upsert: an upsert would need the full row and could resurrect an authored
 * value from a read taken before an editor's save.
 */
/**
 * The narrowest shape `applyLinkStates` needs. Declaring it lets the unit test
 * hand in a recording double WITHOUT mocking the Supabase module, which
 * scripts/check-test-boundaries.mjs forbids outright.
 */
export type LinkStateWriter = {
  from(table: string): {
    update(values: Record<string, unknown>): {
      eq(
        column: string,
        value: string,
      ): PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

export async function applyLinkStates(
  checks: readonly LinkCheck[],
  /** Seam for the unit test; the default is the real service client. */
  client?: LinkStateWriter,
): Promise<void> {
  // The generic PostgREST builder is structurally wider than LinkStateWriter;
  // this cast narrows it at the one call site rather than leaking generics.
  const supabase =
    client ?? (createServiceClient() as unknown as LinkStateWriter);
  for (const check of checks) {
    const { error } = await supabase
      .from("curated_products")
      .update({
        link_state: check.classification.linkState,
        link_checked_at: check.classification.checkedAt,
      })
      .eq("id", check.row.id);
    if (error) {
      throw new Error(`failed to update ${check.row.key}: ${error.message}`);
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  // Preflight before the first write: a write that lands while revalidation is
  // unconfigured leaves every brand page serving a stale shell. Failing before
  // the first write is the reversible failure.
  if (options.apply) assertRevalidationConfigured();

  const rows = await loadProducts(options.brand);

  const checks = options.reviewOnly ? [] : await checkLinks(rows);
  const changed = checks.filter((check) => check.changed);
  const blocked = checks.filter((check) => check.classification.blocked);
  const trailReports = groupLinkChecksByTrail(checks);

  console.log(
    JSON.stringify({
      mode: options.reviewOnly
        ? "review-only"
        : options.apply
          ? "apply"
          : "dry-run",
      brand: options.brand,
      products: rows.length,
      checked: checks.length,
      changed: changed.length,
      // Surfaced, never written: a bot challenge is not evidence of a dead
      // link, so these rows keep whatever link_state they already had.
      blocked: blocked.length,
      trails: trailReports,
    }),
  );
  for (const check of blocked) {
    console.log(
      JSON.stringify({
        blocked: true,
        brandSlug: brandSlugOf(check.row),
        trailSlugs: trailSlugsOf(check.row),
        key: check.row.key,
        status: check.classification.status,
        linkState: check.row.link_state,
      }),
    );
  }
  for (const check of changed) {
    console.log(
      JSON.stringify({
        brandSlug: brandSlugOf(check.row),
        trailSlugs: trailSlugsOf(check.row),
        key: check.row.key,
        from: check.row.link_state,
        to: check.classification.linkState,
        status: check.classification.status,
        redirectedTo: check.classification.redirectedTo,
      }),
    );
  }

  const due = selectReviewDue(
    rows.map((row) => ({
      id: row.id,
      brandId: row.brand_id,
      brandSlug: brandSlugOf(row),
      key: row.key,
      nameZh: row.name_zh,
      lifecycle: row.lifecycle,
      linkState: row.link_state,
      reviewDueAt: row.review_due_at,
    })),
  );
  console.log(JSON.stringify({ reviewDue: due.length }));
  for (const product of due) {
    const row = rows.find((candidate) => candidate.id === product.id);
    console.log(
      JSON.stringify({
        brandSlug: product.brandSlug,
        trailSlugs: row ? trailSlugsOf(row) : [],
        key: product.key,
        nameZh: product.nameZh,
        reviewDueAt: product.reviewDueAt,
        daysOverdue: product.daysOverdue,
        lifecycle: product.lifecycle,
      }),
    );
  }

  if (!options.apply || changed.length === 0) return;

  await applyLinkStates(changed);

  // Without this, a newly-broken URL keeps serving a live call-to-action from
  // the ISR shell for up to an hour and every test still passes. Only the brands
  // whose products actually CHANGED state are revalidated — a run that confirms
  // 700 healthy links must not rebuild the whole directory.
  const slugs = [
    ...new Set(
      changed
        .map((check) => brandSlugOf(check.row))
        .filter((slug): slug is string => Boolean(slug)),
    ),
  ];
  const revalidation = await requestPublicBrandRevalidation(slugs);
  console.log(
    JSON.stringify({
      revalidated: slugs.length,
      ok: revalidation.ok,
      reason: revalidation.reason ?? null,
    }),
  );
  if (!revalidation.ok) {
    // The link states are already committed, so this cannot be undone here —
    // but it must never exit 0. A cron reporting success while a brand page
    // keeps serving a call-to-action to a URL just proven dead is the exact
    // failure this script exists to prevent.
    throw new Error(
      `revalidation failed (${revalidation.reason ?? "unknown"}): brand pages are stale`,
    );
  }
}

// The test imports the pure functions from this module, so importing it must
// never start a run. `main()` fires only when this file IS the process entry
// point — under vitest argv[1] is the runner, not this file.
if (process.argv[1]?.endsWith("curated-products/check-links.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
