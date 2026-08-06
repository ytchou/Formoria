/**
 * DEV-1309 remediation input: which live brands still publish a
 * `purchase_website` that is not the brand's own site, and which of those can
 * still be re-written by current code?
 *
 *   pnpm exec tsx --env-file=.env.local scripts/site-identity-eval/exposure-scan.ts
 *   pnpm exec tsx --env-file=.env.local scripts/site-identity-eval/exposure-scan.ts --out runs/exposure.json
 *
 * This is the scan the DEV-1309 ticket's "Exposure re-measured" section reports,
 * made repeatable. It is read-only and always exits 0 — a report, not a gate.
 *
 * ## Scope: `approved` AND `hidden`
 *
 * Both, deliberately. A `hidden` brand is not published, but it is one admin
 * click from being published and its contaminated column is what a re-approval
 * would ship. Scanning `approved` alone under-counts the remediation set — that
 * is how the original pass missed `梨山福果園`.
 *
 * ## The two contaminated classes
 *
 * `platform` — `isNonBrandSiteHost` already answers this: socials, marketplaces,
 * link-in-bio aggregators, delivery/directory/publishing platforms. A brand's
 * `purchase_website` pointing at one is a dead buy link; it identifies the
 * platform, not the seller.
 *
 * `non_brand_content` — a real company's real domain that is nonetheless not
 * this brand's: a magazine that covers many brands, or a URL shortener that
 * hides whatever it points at. These CANNOT be derived from a rule — a magazine
 * domain is structurally indistinguishable from a brand's own domain — so the
 * list below is evidence-derived and is expected to grow one incident at a time.
 * It is deliberately NOT folded into `NON_BRAND_PLATFORM_HOSTS`: that list feeds
 * the live enrichment guard, and denylisting real companies there is the
 * whack-a-mole the ticket explicitly rejected. Here it only classifies a report.
 *
 * ## Staleness is the part that matters for remediation
 *
 * Clearing a row that current code will simply re-derive on the next curation
 * run wastes the clear and looks like a regression when it reappears. A row is
 * LIVE-WRITABLE only when BOTH hold:
 *
 *   - the brand name yields zero Latin tokens (Han-only), so `deriveOfficialWebsite`
 *     falls through to first-eligible with no identity check, AND
 *   - `isNonBrandSiteHost` does not reject the host, so nothing downstream
 *     catches it either.
 *
 * Everything else is STALE: the guards that wrote it already ship, so clearing
 * it sticks. A LIVE-WRITABLE row must wait for the site-identity ladder to
 * arbitrate it, or it will re-revert.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { brandNameTokens } from "@/lib/services/link-enrichment";
import { isNonBrandSiteHost } from "@/lib/services/enrich-phases/scraper/input-detector";

const BATCH_SIZE = 500;
const SCANNED_STATUSES = ["approved", "hidden"] as const;

/**
 * Hosts that are a real company's real site but never a Formoria brand's own:
 * magazines that cover many brands, and shorteners that hide their target.
 *
 * Evidence-derived, from the DEV-1309 exposure pass. Add a host here only after
 * it has actually appeared in `purchase_website` — a speculative entry cannot be
 * distinguished from a brand that genuinely owns the domain.
 */
const NON_BRAND_CONTENT_HOSTS = [
  // Magazines / media that cover many brands. A systematic attractor, not a one-off:
  // harpersbazaar.com reached two separate brands.
  "harpersbazaar.com",
  "chinajournal.news",
  "smiletaiwan.cw.com.tw",
  "cw.com.tw",
  // URL shorteners — the target is unknowable from the column, so it can never
  // be a trustworthy buy link.
  "reurl.cc",
  "bit.ly",
  "tinyurl.com",
  "pse.is",
  "lihi.cc",
  "lihi1.cc",
  "lihi2.cc",
  "lihi3.cc",
];

/**
 * Link-in-bio aggregators that `isNonBrandSiteHost` does NOT currently reject.
 *
 * The DEV-1309 ticket asserts `portaly.cc` is "already rejected by
 * isNonBrandSiteHost ... LINK_AGGREGATOR_HOSTS". Measured 2026-08-06: it is not
 * in that list. Verified against `input-detector.ts` — the list holds linktr.ee,
 * lit.link, biosites.com, bio.site, beacons.ai, taplink.cc, potato.link,
 * carrd.co, bento.me, solo.to, allmylinks.com, msha.ke, and nothing else.
 *
 * This matters for remediation direction, not just for counting: a host here is
 * contaminated AND unguarded, so clearing it can revert. Worse, an aggregator
 * URL whose PATH carries the brand handle (`portaly.cc/HOORU.HORURU`) passes
 * `linkIdentifiesBrand` on its handle, so Rung 1 CONFIRMS it and the ladder
 * never escalates to Rung 2 either.
 *
 * These rows are reported separately and are NOT cleared until the host is
 * added to `LINK_AGGREGATOR_HOSTS`.
 */
const UNGUARDED_AGGREGATOR_HOSTS = ["portaly.cc", "linkby.tw", "myppt.cc"];

type ContaminationClass =
  | "platform"
  | "non_brand_content"
  | "platform_unguarded";

type BrandRow = {
  slug: string;
  name: string | null;
  status: string;
  purchase_website: string | null;
};

type ExposureRow = {
  slug: string;
  name: string | null;
  status: string;
  purchaseWebsite: string;
  contamination: ContaminationClass;
  host: string;
  /** True when current code can re-derive this value, so clearing it will revert. */
  liveWritable: boolean;
  hanOnly: boolean;
};

type ExposureReport = {
  ranAt: string;
  statuses: string[];
  rowsScanned: number;
  withPurchaseWebsite: number;
  contaminated: number;
  stale: number;
  liveWritable: number;
  byClass: Record<ContaminationClass, number>;
  rows: ExposureRow[];
};

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv.at(index + 1);
}

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  return createSupabaseClient(url, serviceRoleKey);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** The URL's hostname, or `null` when it will not parse — an unparseable value is not classifiable. */
function hostOf(url: string): string | null {
  try {
    return new URL(url.trim()).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function isNonBrandContentHost(host: string): boolean {
  return NON_BRAND_CONTENT_HOSTS.some(
    (entry) => host === entry || host.endsWith(`.${entry}`),
  );
}

/**
 * The contaminated class of a stored website, or `null` when it looks like the
 * brand's own site. `platform` is checked first: it is the guard the live
 * pipeline actually consults, so a host in both lists should report as the one
 * that already blocks it.
 */
function classify(url: string, host: string): ContaminationClass | null {
  if (isNonBrandSiteHost(url)) return "platform";
  if (isUnguardedAggregatorHost(host)) return "platform_unguarded";
  if (isNonBrandContentHost(host)) return "non_brand_content";
  return null;
}

function isUnguardedAggregatorHost(host: string): boolean {
  return UNGUARDED_AGGREGATOR_HOSTS.some(
    (entry) => host === entry || host.endsWith(`.${entry}`),
  );
}

function printReport(report: ExposureReport): void {
  console.log(
    `\nscanned ${report.rowsScanned} brand(s) in status ${report.statuses.join("/")} — ${report.withPurchaseWebsite} hold a purchase_website`,
  );
  console.log(
    `contaminated: ${report.contaminated}  (${report.stale} stale, ${report.liveWritable} live-writable)`,
  );
  console.log(
    `  platform ${report.byClass.platform}  non_brand_content ${report.byClass.non_brand_content}  platform_unguarded ${report.byClass.platform_unguarded}\n`,
  );

  if (report.rows.length === 0) {
    console.log("No contaminated rows. Nothing to remediate.");
    return;
  }

  const stale = report.rows.filter((row) => !row.liveWritable);
  const live = report.rows.filter((row) => row.liveWritable);

  console.log(`## STALE — safe to clear, current code will not re-derive (${stale.length})`);
  for (const row of stale) {
    console.log(
      `  ${row.slug.padEnd(28)} ${row.status.padEnd(9)} ${row.contamination.padEnd(18)} ${row.purchaseWebsite}`,
    );
  }

  console.log(
    `\n## LIVE-WRITABLE — clearing REVERTS on the next run; needs the ladder first (${live.length})`,
  );
  for (const row of live) {
    console.log(
      `  ${row.slug.padEnd(28)} ${row.status.padEnd(9)} ${row.contamination.padEnd(18)} ${row.purchaseWebsite}`,
    );
  }

  console.log("\n## cohort labels block (paste into the remediation cohort JSON)");
  console.log(
    JSON.stringify(
      Object.fromEntries(stale.map((row) => [row.slug, row.name ?? row.slug])),
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const outPath = argValue("--out");
  const supabase = createServiceClient();

  let offset = 0;
  let rowsScanned = 0;
  let withPurchaseWebsite = 0;
  const rows: ExposureRow[] = [];

  while (true) {
    const { data, error } = await supabase
      .from("brands")
      .select("slug, name, status, purchase_website")
      .in("status", SCANNED_STATUSES)
      .order("slug", { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);
    if (error) throw error;

    const page = (data ?? []) as unknown as BrandRow[];
    if (page.length === 0) break;
    rowsScanned += page.length;

    for (const brand of page) {
      const website = brand.purchase_website;
      if (!isNonEmptyString(website)) continue;
      withPurchaseWebsite += 1;

      const host = hostOf(website);
      if (host === null) continue;

      const contamination = classify(website, host);
      if (contamination === null) continue;

      const hanOnly = brandNameTokens(brand.name).length === 0;
      rows.push({
        slug: brand.slug,
        name: brand.name,
        status: brand.status,
        purchaseWebsite: website,
        contamination,
        host,
        // Two ways a cleared value comes back. The Han-only fall-through can
        // re-derive it when the host guard would not reject it on the way in;
        // and an unguarded aggregator is by definition not rejected by anything,
        // so it is re-derivable whatever the brand's name looks like.
        liveWritable:
          contamination === "platform_unguarded" ||
          (hanOnly && !isNonBrandSiteHost(website)),
        hanOnly,
      });
    }

    if (page.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  const report: ExposureReport = {
    ranAt: new Date().toISOString(),
    statuses: [...SCANNED_STATUSES],
    rowsScanned,
    withPurchaseWebsite,
    contaminated: rows.length,
    stale: rows.filter((row) => !row.liveWritable).length,
    liveWritable: rows.filter((row) => row.liveWritable).length,
    byClass: {
      platform: rows.filter((row) => row.contamination === "platform").length,
      non_brand_content: rows.filter(
        (row) => row.contamination === "non_brand_content",
      ).length,
      platform_unguarded: rows.filter(
        (row) => row.contamination === "platform_unguarded",
      ).length,
    },
    rows,
  };

  printReport(report);

  if (outPath) {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(report, null, 2));
    console.log(`\nwrote ${outPath}`);
  }
}

void main().catch((error) => {
  console.error(
    "\nFAILED:",
    error instanceof Error ? (error.stack ?? error.message) : JSON.stringify(error),
  );
  // Still 0: a failed run is reported, not asserted.
  process.exit(0);
});
