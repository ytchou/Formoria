/**
 * Audits `brand_slug_redirects` for the faults that make Googlebot report a
 * "Redirect error" rather than following the hop.
 *
 * Search Console's Redirect error bucket is populated by redirects that never
 * resolve — a loop, a chain longer than the crawler's budget, or a hop into a
 * URL that is not there. None of those are visible from the table itself: every
 * row looks individually correct, and the fault only exists in the graph they
 * form together. This walks that graph.
 *
 * Usage: pnpm seo:redirect-health
 * Exits non-zero when a blocking fault is found, so it can gate a rename batch.
 */

import { pathToFileURL } from "node:url";
import { createServiceClient } from "@/lib/supabase/service";
import { loadScriptTarget } from "../shared/target";

export type RedirectRow = {
  old_slug: string;
  new_slug: string;
};

export type BrandStatusRow = {
  slug: string;
  status: string;
};

export type RedirectFinding = {
  oldSlug: string;
  newSlug: string;
  detail: string;
};

export type RedirectAudit = {
  /** A hop that returns to a slug already visited — Googlebot gives up. */
  cycles: RedirectFinding[];
  /** A target that is itself redirected; every extra hop spends crawl budget. */
  chains: RedirectFinding[];
  /** A target with no brand row at all: a redirect straight into a 404. */
  missingTargets: RedirectFinding[];
  /**
   * A target that exists but is not approved. NOT a fault: the resolver joins
   * on `status = 'approved'`, so the row stays inert and the URL 404s until the
   * brand is unhidden. Reported because deleting these would silently discard a
   * correct mapping the moment someone unhides the brand.
   */
  dormant: RedirectFinding[];
};

/** Findings that mean a real crawler failure, as opposed to an inert row. */
export function blockingFindingCount(audit: RedirectAudit): number {
  return (
    audit.cycles.length + audit.chains.length + audit.missingTargets.length
  );
}

export function auditBrandRedirects(
  redirects: RedirectRow[],
  brands: BrandStatusRow[],
): RedirectAudit {
  const targetOf = new Map(
    redirects.map((row) => [row.old_slug, row.new_slug]),
  );
  const statusOf = new Map(brands.map((brand) => [brand.slug, brand.status]));

  const audit: RedirectAudit = {
    cycles: [],
    chains: [],
    missingTargets: [],
    dormant: [],
  };

  for (const { old_slug: oldSlug, new_slug: newSlug } of redirects) {
    // Walk the whole chain rather than peeking one hop ahead: A->B->C->A is a
    // loop that a single-step check reads as an ordinary two-hop chain.
    const seen = new Set([oldSlug]);
    let cursor = newSlug;
    let looped = false;

    while (targetOf.has(cursor)) {
      if (seen.has(cursor)) {
        looped = true;
        break;
      }
      seen.add(cursor);
      cursor = targetOf.get(cursor) as string;
    }

    if (looped) {
      audit.cycles.push({
        oldSlug,
        newSlug,
        detail: `redirect loop: ${[...seen, cursor].join(" -> ")}`,
      });
      continue;
    }

    if (targetOf.has(newSlug)) {
      audit.chains.push({
        oldSlug,
        newSlug,
        detail: `chained hop: ${oldSlug} -> ${newSlug} -> ${targetOf.get(newSlug)}`,
      });
    }

    const status = statusOf.get(cursor);
    if (status === undefined) {
      audit.missingTargets.push({
        oldSlug,
        newSlug,
        detail: `no brand row for "${cursor}" — this redirect lands on a 404`,
      });
    } else if (status !== "approved") {
      audit.dormant.push({
        oldSlug,
        newSlug,
        detail: `target "${cursor}" is ${status}; the row stays inert until it is approved`,
      });
    }
  }

  return audit;
}

/** PostgREST caps an unbounded select at 1000 rows; page under that cap. */
const PAGE_SIZE = 1000;

async function fetchAll<T>(
  table: "brands" | "brand_slug_redirects",
  columns: string,
): Promise<T[]> {
  const client = createServiceClient();
  const rows: T[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;

    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

async function main(): Promise<void> {
  loadScriptTarget();
  try {
    const [redirects, brands] = await Promise.all([
      fetchAll<RedirectRow>("brand_slug_redirects", "old_slug, new_slug"),
      fetchAll<BrandStatusRow>("brands", "slug, status"),
    ]);

    const audit = auditBrandRedirects(redirects, brands);
    const blocking = blockingFindingCount(audit);

    console.log(
      JSON.stringify(
        {
          event: "brand_redirect_health",
          redirectCount: redirects.length,
          blocking,
          summary: {
            cycles: audit.cycles.length,
            chains: audit.chains.length,
            missingTargets: audit.missingTargets.length,
            dormant: audit.dormant.length,
          },
          ...audit,
        },
        null,
        2,
      ),
    );

    if (blocking > 0) process.exit(1);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

// pathToFileURL, not a `file://` template: a repo path containing a space, `#`
// or non-ASCII character percent-encodes in import.meta.url, and the naive
// comparison would silently skip main() and exit 0 printing nothing.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
