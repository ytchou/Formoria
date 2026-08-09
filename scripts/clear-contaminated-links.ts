/**
 * Operator script: clear third-party links that enrichment published as brands'
 * own, and report the ambiguous pairs a human has to judge (DEV-1332).
 *
 * Three classes, from the validation half of the fill-gaps-then-validate split:
 *
 *  1. FANOUT. A social URL carried by MORE THAN TWO approved brands is
 *     contamination, never duplication — the same page cannot be three
 *     unrelated brands' official account. One creativexpo.tw exhibitor listing
 *     donated the organiser's Facebook page to 23 brands, and @cosme Taiwan's
 *     accounts reached five of the brands it stocks. Exactly two is ambiguous
 *     (it may be one brand entered twice) and is reported, never cleared.
 *  2. BARE PLATFORM. A `purchase_website` that is a platform's front door
 *     (`threads.com`) is a dead buy link: it identifies the platform, not the
 *     seller.
 *  3. PAIRS. Everything at fanout 2 is printed for manual duplicate review.
 *     `CY Food` / `川元食品 Chuan Yuan` share zero text and no name rule can
 *     ever catch them, but they share both socials — link identity is a
 *     strictly stronger duplicate signal than name similarity. Never merged
 *     here: only a human can tell a duplicate from two contaminated rows.
 *  4. LEGACY ZERO-TOKEN WEBSITE (DEV-1310). Verdict-driven, not shape-driven:
 *     the cohort scan's site-identity verdicts clear purchase_website only when
 *     the decision is `clear`. A no-evidence / unscoreable row is never a clear:
 *     the scan excludes it, and this script re-checks the decision field rather
 *     than re-deriving a judgment from the URL.
 *
 * Fields are cleared to NULL, not corrected. An empty column is honest and the
 * enrichment pipeline can refill it later from better evidence; a guess cannot
 * be distinguished from the contamination it replaces. `purchase_website` is
 * never touched by the fanout rule — the @cosme brands' websites are correct.
 *
 * Every clear is recorded in `brand_field_events` with the old value, so a
 * wrongly cleared link is recoverable.
 *
 * Usage:
 *   pnpm clear-contaminated-links            # dry run: report only
 *   pnpm clear-contaminated-links --apply    # clear
 *   pnpm clear-contaminated-links --verdicts <path>                # + DEV-1310 class, dry run
 *   pnpm clear-contaminated-links --verdicts <path> --apply        # + DEV-1310 class, clear
 */
import { readFileSync } from "node:fs";
import { createServiceClient } from "@/lib/supabase/service";
import { isNonBrandSiteHost } from "@/lib/services/enrich-phases/scraper/input-detector";

const APPLY = process.argv.includes("--apply");

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv.at(index + 1);
}

/**
 * Above this many approved brands, a shared social URL is contamination. At
 * exactly this many it is ambiguous, so 2 reports and 3 clears.
 */
const FANOUT_CEILING = 2;

/**
 * The `Clear.reason` class 4 writes, and therefore the string that lands in
 * `brand_field_events`. Named once so the report grouping and the event trail
 * can never drift apart.
 */
const LEGACY_ZERO_TOKEN_REASON = "legacy-zero-token-website";

/** Only socials fan out this way; a website is judged by shape, not by count. */
const SOCIAL_COLUMNS = [
  "social_instagram",
  "social_threads",
  "social_facebook",
] as const;

type SocialColumn = (typeof SOCIAL_COLUMNS)[number];
type LinkColumn = SocialColumn | "purchase_website";

type BrandLinks = {
  id: string;
  slug: string;
  name: string;
  social_instagram: string | null;
  social_threads: string | null;
  social_facebook: string | null;
  purchase_website: string | null;
};

type VerdictRow = {
  slug: string;
  brandName: string;
  url: string;
  confidence: string;
  reason: string;
  evidencePresent: boolean;
  decision: "clear" | "keep" | "unscoreable";
};

type LegacyClear = VerdictRow & { brandId: string };

type LegacyVerdicts = {
  clears: LegacyClear[];
  malformed: string[];
};

type CurrentVerdictBrand = {
  id: string;
  slug: string;
  name: string | null;
  status: string;
  purchase_website: string | null;
};

type Clear = {
  brandId: string;
  brandName: string;
  column: LinkColumn;
  value: string;
  reason: string;
};

/** Scheme, `www.`, case, and a trailing slash are noise when comparing links. */
function linkKey(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/\/+$/, "");
}

/**
 * True when `purchase_website` holds a platform rather than the brand's site.
 *
 * A bare origin is NOT the test on its own: a brand's own website legitimately
 * is one, and `deriveOfficialWebsite` returns origins by design. What makes
 * `https://www.threads.com` wrong is the host — `isNonBrandSiteHost` is the
 * codebase's existing answer for that, and it covers socials, marketplaces,
 * aggregators, and directories on any path.
 */
function isPlatformWebsite(url: string): boolean {
  return isNonBrandSiteHost(url);
}

async function fetchApprovedBrands(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<BrandLinks[]> {
  const brands: BrandLinks[] = [];
  const pageSize = 1_000;

  // PostgREST caps a response at 1000 rows; the directory is past that.
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("brands")
      .select(
        "id, slug, name, social_instagram, social_threads, social_facebook, purchase_website",
      )
      .eq("status", "approved")
      .order("id")
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);
    const page = (data ?? []) as BrandLinks[];
    brands.push(...page);
    if (page.length < pageSize) return brands;
  }
}

function loadLegacyVerdicts(path: string): LegacyVerdicts {
  const raw = readFileSync(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  const rowsValue =
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { rows?: unknown }).rows)
      ? (parsed as { rows: unknown[] }).rows
      : undefined;
  const malformed: string[] = [];
  const clears: LegacyClear[] = [];
  if (!rowsValue) {
    malformed.push("report: rows is missing or not an array");
    return { clears, malformed };
  }
  for (const [index, value] of rowsValue.entries()) {
    if (!value || typeof value !== "object") {
      malformed.push(`row ${index}: not an object`);
      continue;
    }
    const row = value as Record<string, unknown>;
    if (
      typeof row.slug !== "string" ||
      typeof row.brandName !== "string" ||
      typeof row.url !== "string" ||
      typeof row.confidence !== "string" ||
      typeof row.reason !== "string" ||
      row.evidencePresent !== true ||
      row.decision !== "clear"
    ) {
      if (row.decision === "clear")
        malformed.push(`row ${index}: missing or invalid clear fields`);
      continue;
    }
    clears.push({
      slug: row.slug,
      brandName: row.brandName,
      url: row.url,
      confidence: row.confidence,
      reason: row.reason,
      evidencePresent: true,
      decision: "clear",
      brandId: "",
    });
  }
  return { clears, malformed };
}

async function collectLegacyClears(
  supabase: ReturnType<typeof createServiceClient>,
  verdictPath: string | undefined,
): Promise<{
  clears: Clear[];
  proposed: LegacyClear[];
  skipped: string[];
  malformed: string[];
}> {
  if (!verdictPath)
    return { clears: [], proposed: [], skipped: [], malformed: [] };
  const verdicts = loadLegacyVerdicts(verdictPath);
  if (verdicts.clears.length === 0)
    return {
      clears: [],
      proposed: [],
      skipped: [],
      malformed: verdicts.malformed,
    };
  const slugs = [...new Set(verdicts.clears.map((row) => row.slug))];
  const { data, error } = await supabase
    .from("brands")
    .select("id, slug, name, status, purchase_website")
    .in("slug", slugs);
  if (error) throw new Error(error.message);
  const current = new Map(
    ((data ?? []) as CurrentVerdictBrand[]).map((brand) => [brand.slug, brand]),
  );
  const clears: Clear[] = [];
  const proposed: LegacyClear[] = [];
  const skipped: string[] = [];
  for (const row of verdicts.clears) {
    const brand = current.get(row.slug);
    // The scan and apply are separate runs, potentially days apart. A brand may
    // have been re-curated or its owner may have corrected the link in between.
    // linkKey treats scheme, www, case, and trailing slash rewrites as noise so
    // those normalisations are not mistaken for an edit to the scored value.
    if (
      !brand ||
      brand.status !== "approved" ||
      !brand.purchase_website ||
      linkKey(brand.purchase_website) !== linkKey(row.url)
    ) {
      skipped.push(
        `${row.brandName} — ${row.url} — ${!brand ? "not found" : brand.status !== "approved" ? `status=${brand.status}` : "changed since scan"}`,
      );
      continue;
    }
    const accepted = {
      ...row,
      brandId: brand.id,
      brandName: brand.name ?? row.brandName,
    };
    proposed.push(accepted);
    clears.push({
      brandId: brand.id,
      brandName: accepted.brandName,
      column: "purchase_website",
      value: brand.purchase_website,
      reason: LEGACY_ZERO_TOKEN_REASON,
    });
  }
  return { clears, proposed, skipped, malformed: verdicts.malformed };
}

function collectClears(brands: BrandLinks[]): {
  clears: Clear[];
  pairs: Array<{ key: string; column: SocialColumn; brands: BrandLinks[] }>;
} {
  const byKey = new Map<
    string,
    { column: SocialColumn; brands: BrandLinks[] }
  >();

  for (const brand of brands) {
    for (const column of SOCIAL_COLUMNS) {
      const value = brand[column];
      if (!value?.trim()) continue;
      const key = `${column}::${linkKey(value)}`;
      const entry = byKey.get(key) ?? { column, brands: [] };
      entry.brands.push(brand);
      byKey.set(key, entry);
    }
  }

  const clears: Clear[] = [];
  const pairs: Array<{
    key: string;
    column: SocialColumn;
    brands: BrandLinks[];
  }> = [];

  for (const [key, entry] of byKey) {
    if (entry.brands.length > FANOUT_CEILING) {
      for (const brand of entry.brands) {
        clears.push({
          brandId: brand.id,
          brandName: brand.name,
          column: entry.column,
          value: brand[entry.column] as string,
          reason: `fanout:${entry.brands.length}`,
        });
      }
    } else if (entry.brands.length === FANOUT_CEILING) {
      pairs.push({ key: key.split("::").slice(1).join("::"), ...entry });
    }
  }

  for (const brand of brands) {
    const website = brand.purchase_website;
    if (website?.trim() && isPlatformWebsite(website)) {
      clears.push({
        brandId: brand.id,
        brandName: brand.name,
        column: "purchase_website",
        value: website,
        reason: "platform-not-brand-site",
      });
    }
  }

  return { clears, pairs };
}

async function applyClears(
  supabase: ReturnType<typeof createServiceClient>,
  clears: Clear[],
): Promise<void> {
  // Grouped per brand so a brand with two contaminated socials is one UPDATE.
  const byBrand = new Map<string, Clear[]>();
  for (const clear of clears) {
    byBrand.set(clear.brandId, [...(byBrand.get(clear.brandId) ?? []), clear]);
  }

  for (const [brandId, brandClears] of byBrand) {
    const patch = Object.fromEntries(
      brandClears.map((clear) => [clear.column, null]),
    );
    const { error } = await supabase
      .from("brands")
      .update(patch)
      .eq("id", brandId)
      .eq("status", "approved");

    if (error) {
      console.error(`  FAILED ${brandClears[0].brandName}: ${error.message}`);
      continue;
    }

    // The brands table has no audit trigger — the SQL apply functions write
    // these rows themselves, so a script that updates directly must too, or the
    // cleared value becomes unrecoverable.
    const { error: eventError } = await supabase
      .from("brand_field_events")
      .insert(
        brandClears.map((clear) => ({
          brand_id: brandId,
          field: clear.column,
          old_value: clear.value,
          new_value: null,
          source: "admin",
        })),
      );

    if (eventError) {
      console.error(
        `  WARNING ${brandClears[0].brandName}: cleared but not audited — ${eventError.message}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const verdictPath = argValue("--verdicts");
  const supabase = createServiceClient();
  const brands = await fetchApprovedBrands(supabase);
  const { clears, pairs } = collectClears(brands);
  const legacy = await collectLegacyClears(supabase, verdictPath);
  clears.push(...legacy.clears);

  console.log(`Approved brands scanned: ${brands.length}`);
  console.log(
    `Fields to clear: ${clears.length} across ${new Set(clears.map((c) => c.brandId)).size} brand(s)\n`,
  );

  const byReason = new Map<string, Clear[]>();
  for (const clear of clears) {
    // Class 4 is omitted from this generic grouping and printed in its own
    // section below, which carries the confidence and the model's reason —
    // the two fields an operator needs to sanity-check a verdict-driven clear,
    // and which `brandName — column = value` cannot show. Listing it in both
    // places would double-count it to a reader tallying the sections.
    if (clear.reason === LEGACY_ZERO_TOKEN_REASON) continue;
    const bucket = clear.reason.startsWith("fanout") ? "fanout" : clear.reason;
    byReason.set(bucket, [...(byReason.get(bucket) ?? []), clear]);
  }

  for (const [reason, group] of byReason) {
    console.log(`## ${reason} (${group.length})`);
    for (const clear of group) {
      console.log(`  ${clear.brandName} — ${clear.column} = ${clear.value}`);
    }
    console.log();
  }

  if (verdictPath) {
    console.log(
      `## legacy zero-token website (DEV-1310) — proposed clears (${legacy.proposed.length})`,
    );
    for (const clear of legacy.proposed) {
      console.log(
        `  ${clear.brandName} — ${clear.url} — ${clear.confidence} — ${clear.reason}`,
      );
    }
    console.log();
    console.log(
      `## legacy zero-token website — skipped — changed since scan (${legacy.skipped.length})`,
    );
    for (const skipped of legacy.skipped) console.log(`  ${skipped}`);
    console.log();
    console.log(
      `## legacy zero-token website — malformed verdict rows (${legacy.malformed.length})`,
    );
    for (const malformed of legacy.malformed) console.log(`  ${malformed}`);
    console.log();
  }

  console.log(
    `## manual duplicate review — fanout ${FANOUT_CEILING} (${pairs.length})`,
  );
  for (const pair of pairs) {
    console.log(
      `  ${pair.key} [${pair.column}]: ${pair.brands.map((b) => b.name).join("  |  ")}`,
    );
  }
  console.log();

  if (!APPLY) {
    console.log("Dry run. Re-run with --apply to clear.");
    return;
  }

  await applyClears(supabase, clears);
  console.log(`Cleared ${clears.length} field(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
