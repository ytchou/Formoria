import { auditedCall } from "@/lib/audit";
import { requestPublicBrandRevalidation } from "@/lib/cache/revalidate-client";
import { createServiceClient } from "@/lib/supabase/service";
import { isPrivateUrl } from "@/lib/url";

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
 * asserted in the rationale. `review_due_at` is authored in the YAML and this
 * script never writes it — it only reports the rows that have gone past it.
 *
 * LINK HEALTH IS NOT AVAILABILITY. A 200 proves the page resolves. It never
 * proves the product is in stock, still priced the same, or still sold. Nothing
 * here records stock, price, inventory, or availability; those are commercial
 * facts with a freshness obligation nothing in this product can honour, which
 * is exactly why `curated_products` has no column for them.
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

export type LinkClassification = {
  linkState: CuratedLinkState;
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
    checkedAt: now().toISOString(),
  };

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

function parseArgs(argv: string[]): CliOptions {
  const brandArg = argv.find((arg) => arg.startsWith("--brand="));
  const brandIndex = argv.indexOf("--brand");
  const brand = brandArg
    ? brandArg.slice("--brand=".length)
    : brandIndex === -1
      ? null
      : (argv.at(brandIndex + 1) ?? null);
  if (brand !== null && (!brand || brand.startsWith("--"))) {
    throw new Error("--brand requires a brand slug");
  }
  return {
    apply: argv.includes("--apply"),
    brand,
    reviewOnly: argv.includes("--review-only"),
  };
}

type ProductRow = {
  id: string;
  brand_id: string;
  key: string;
  name_zh: string;
  lifecycle: string;
  official_url: string | null;
  link_state: string;
  review_due_at: string | null;
  brands: { slug: string | null } | { slug: string | null }[] | null;
};

function brandSlugOf(row: ProductRow): string | null {
  const brands = Array.isArray(row.brands) ? row.brands[0] : row.brands;
  return brands?.slug ?? null;
}

async function loadProducts(brand: string | null): Promise<ProductRow[]> {
  const supabase = createServiceClient();
  let query = supabase
    .from("curated_products")
    .select(
      "id, brand_id, key, name_zh, lifecycle, official_url, link_state, review_due_at, brands!inner(slug)",
    )
    .neq("lifecycle", "retired");
  if (brand) query = query.eq("brands.slug", brand);

  const { data, error } = await query;
  if (error)
    throw new Error(`failed to load curated products: ${error.message}`);
  return (data ?? []) as unknown as ProductRow[];
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
async function probe(url: string): Promise<LinkProbe> {
  if (isPrivateUrl(url)) {
    return { requestedUrl: url, resolvedUrl: null, status: null };
  }

  return auditedCall(
    { provider: "http", operation: "check_link", kind: "external" },
    async (ctx): Promise<LinkProbe> => {
      const request = async (method: "HEAD" | "GET") => {
        const response = await fetch(url, {
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

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index]!);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

type LinkCheck = {
  row: ProductRow;
  classification: LinkClassification;
  changed: boolean;
};

async function checkLinks(rows: readonly ProductRow[]): Promise<LinkCheck[]> {
  const checkable = rows.filter((row) => Boolean(row.official_url));
  return mapWithConcurrency(checkable, CONCURRENCY, async (row) => {
    const classification = classify(await probe(row.official_url!));
    return {
      row,
      classification,
      changed: classification.linkState !== row.link_state,
    };
  });
}

/**
 * Writes the two link columns and NOTHING else. Row-at-a-time rather than an
 * upsert: an upsert would need the full row and could resurrect an authored
 * value from a read taken before an editor's save.
 */
async function applyLinkStates(checks: readonly LinkCheck[]): Promise<void> {
  const supabase = createServiceClient();
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
  const rows = await loadProducts(options.brand);

  const checks = options.reviewOnly ? [] : await checkLinks(rows);
  const changed = checks.filter((check) => check.changed);

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
    }),
  );
  for (const check of changed) {
    console.log(
      JSON.stringify({
        brandSlug: brandSlugOf(check.row),
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
    console.log(
      JSON.stringify({
        brandSlug: product.brandSlug,
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
