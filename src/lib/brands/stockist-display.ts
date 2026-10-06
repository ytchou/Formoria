import type { Stockist } from "@/lib/types/stockist";
import { CITY_NAMES_ZH } from "@/lib/constants/taiwan-cities";

const REGION_SLUG_BY_LABEL: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(CITY_NAMES_ZH).map(([slug, label]) => [label, slug]),
  );

/**
 * The PostgREST spelling of "not a community submission still awaiting review".
 *
 * A community row is a stranger's claim about a shop until an admin has looked
 * at it (`/admin/stockists`), so it must be excluded from EVERY public read:
 * the per-brand read, both paginated directory reads, and the independent query
 * in `scripts/story-facts.ts`. De Morgan of `source = 'community' AND
 * owner_status = 'none'` — both columns are NOT NULL, so there is no null trap
 * in the negation.
 *
 * Stated once, here, because the four call sites are unrelated to any compiler:
 * the untyped service client accepts a read that simply forgets it.
 */
export const PENDING_COMMUNITY_EXCLUSION =
  "source.neq.community,owner_status.neq.none";

/**
 * Deliberately NOT `<Q extends PublicStockistQuery<Q>>`. A self-referential
 * constraint makes tsc structurally re-check the whole PostgREST builder once
 * per method, and three methods against `.select(STOCKIST_DETAIL_READ_SELECT)` exceeds
 * the instantiation depth limit (TS2589). `excludeTestBrands` gets away with
 * the recursive form because it constrains exactly one method.
 */
type PublicStockistQuery = {
  is(column: string, value: null): PublicStockistQuery;
  neq(column: string, value: string): PublicStockistQuery;
  or(filters: string): PublicStockistQuery;
};

/**
 * The whole public visibility contract for `brand_channels`, in one chainable
 * call: not tombstoned, not owner-rejected, and not an unreviewed community
 * submission.
 *
 * Four unrelated queries need all three, and they had drifted before this
 * existed — `scripts/story-facts.ts` carried a hand-copied pair of filters, and
 * `fetchStockistRows` states its pair twice because it pages. The service
 * client is untyped, so a read that applies two of the three type-checks,
 * lints, and ships; the only symptom is a stranger's unverified shop appearing
 * on a live brand page.
 *
 * Structurally typed rather than tied to `PostgrestFilterBuilder`, exactly like
 * `excludeTestBrands`: that keeps it callable from a plain query spy, which is
 * the only unit-testable shape available (`check-test-boundaries.mjs` forbids
 * mocking the Supabase client).
 */
export function applyPublicStockistVisibility<Q>(query: Q): Q {
  return (query as PublicStockistQuery)
    .is("removed_at", null)
    .neq("owner_status", "rejected")
    .or(PENDING_COMMUNITY_EXCLUSION) as Q;
}

/** Same reason as `PublicStockistQuery` for not being self-referential. */
type PendingCommunityQuery = {
  eq(column: string, value: string): PendingCommunityQuery;
  is(column: string, value: null): PendingCommunityQuery;
};

/**
 * The exact complement of `PENDING_COMMUNITY_EXCLUSION`: a community
 * submission with no decision on it, and not tombstoned.
 *
 * Three unrelated sites need all THREE conditions — the admin queue read
 * (`listPendingCommunityStockists`), the queue badge count
 * (`getAdminNavCounts`), and the approve/reject write
 * (`reviewCommunityStockist`) — and the write is the one that must not drift:
 * a missing `removed_at is null` there publishes a tombstoned row onto a live
 * brand page, a row no admin could have seen in the queue. Stated once, here,
 * for the same reason the exclusion above is: the untyped service client
 * accepts a query that simply forgets a condition.
 */
export function applyPendingCommunityStockistFilter<Q>(query: Q): Q {
  return (query as PendingCommunityQuery)
    .eq("source", "community")
    .eq("owner_status", "none")
    .is("removed_at", null) as Q;
}

/**
 * Region-label sentinel the enrichment phase writes for multi-branch retailers.
 * Data value, not UI copy — the UI matches on it to suppress a location label.
 */
export const CHAIN_REGION_LABEL = "全台多間門市";

const RETAILER_NAME_NOISE: readonly string[] = [
  "戶外休閒專業中心",
  "戶外用品專門店",
  "戶外用品店",
  "戶外休閒",
  "戶外用品",
  "戶外",
  "專業中心",
  "旗艦門市",
  "旗艦店",
  "專賣店",
  "用品店",
  "分公司",
  "門市",
  "分店",
  "選物",
  "商店",
  "店",
];

export function normalizeStockistName(name: string): string {
  let normalized = name.toLocaleLowerCase().replace(/\s+/g, "");

  let stripped: boolean;
  do {
    stripped = false;
    for (const noise of RETAILER_NAME_NOISE) {
      if (normalized.endsWith(noise)) {
        const withoutNoise = normalized.slice(0, -noise.length);
        if (withoutNoise) {
          normalized = withoutNoise;
          stripped = true;
          break;
        }
      }
    }
  } while (stripped);

  return normalized;
}

const SECTION_NUMERALS: Readonly<Record<string, string>> = {
  一: "1",
  二: "2",
  三: "3",
  四: "4",
  五: "5",
  六: "6",
  七: "7",
  八: "8",
  九: "9",
  十: "10",
};

/**
 * Address spelling differences seen between an import row and an enriched
 * candidate for one store: full-width forms, 臺/台, a leading postcode, and
 * 三段/3段. A lone numeral directly before 段 is the only one converted —
 * `中正三路` is a street name, not a section number.
 */
export function normalizeStockistAddress(address: string): string {
  return address
    .normalize("NFKC")
    .replace(/臺/g, "台")
    .replace(/\s+/g, "")
    .replace(/^\d{3,6}/, "")
    .replace(
      /(^|[^一二三四五六七八九十])([一二三四五六七八九十])段/g,
      (_match, before: string, numeral: string) =>
        `${before}${SECTION_NUMERALS[numeral]}段`,
    );
}

const LEADING_CITY = new RegExp(
  `^(?:${[
    ...new Set(
      Object.values(CITY_NAMES_ZH).map((label) =>
        label.replace(/臺/g, "台").replace(/[市縣]$/, ""),
      ),
    ),
  ].join("|")})[市縣]?`,
);

function stripLeadingCity(name: string): string {
  const core = name.replace(/臺/g, "台");
  const withoutCity = core.replace(LEADING_CITY, "");
  return withoutCity || core;
}

/**
 * The store part of a stockist name: `normalizeStockistName` with a leading
 * city removed (`full`), and the same cut at a `｜` suffix such as `｜HIS 展售`
 * (`cut`). Each removal applies only when something is left, so a name is never
 * reduced to nothing.
 */
function coreStockistNames(name: string): {
  full: string;
  cut: string;
  hasSeparator: boolean;
} {
  const normalized = normalizeStockistName(name);
  const separator = normalized.search(/[｜|]/);
  const hasSeparator = separator > 0;
  return {
    full: stripLeadingCity(normalized),
    cut: stripLeadingCity(
      hasSeparator ? normalized.slice(0, separator) : normalized,
    ),
    hasSeparator,
  };
}

export type StockistIdentity = {
  name: string;
  /** Falls back to `normalizeStockistName(name)` when absent or blank. */
  normalizedName?: string | null;
  address?: string | null;
};

/**
 * Whether two stockist rows name one physical store (DEV-1942).
 *
 * 1. Equal normalized names: the `upsert_enriched_brand_channels` conflict key.
 * 2. Both addresses present: equal normalized addresses AND one cut core name
 *    containing the other. An address alone is not enough — two airport shops
 *    or two counters in one mall share a street address.
 * 3. An address missing (skipped when `coreNameFallback` is false): equal
 *    uncut core names, or exactly one name has a `｜` suffix and the part
 *    before it equals the other core. Two suffixed names never match on their
 *    shared prefix — `Tcf. | 台北信義店` and `Tcf. | 台中店` are two branches.
 *
 * A miss is a duplicate row for any spelling `normalizeStockistAddress` does
 * not cover. A false match drops a store: rule 3 still matches two branches
 * whose names differ only by a leading city (`台北 好丘` / `台中 好丘`) when
 * an address is missing. Callers that hold rows the import split by region
 * (`withRegionSuffix` in `stockist-import/plan.ts`) pass
 * `coreNameFallback: false`.
 */
export function isSameStockist(
  a: StockistIdentity,
  b: StockistIdentity,
  options: { coreNameFallback?: boolean } = {},
): boolean {
  const normalizedA = a.normalizedName?.trim() || normalizeStockistName(a.name);
  const normalizedB = b.normalizedName?.trim() || normalizeStockistName(b.name);
  if (normalizedA === normalizedB) return true;

  const coreA = coreStockistNames(a.name);
  const coreB = coreStockistNames(b.name);
  if (!coreA.cut || !coreB.cut) return false;

  const addressA = a.address ? normalizeStockistAddress(a.address) : "";
  const addressB = b.address ? normalizeStockistAddress(b.address) : "";
  if (addressA && addressB) {
    return (
      addressA === addressB &&
      (coreA.cut.includes(coreB.cut) || coreB.cut.includes(coreA.cut))
    );
  }
  if (options.coreNameFallback === false) return false;
  if (coreA.full === coreB.full) return true;
  if (coreA.hasSeparator === coreB.hasSeparator) return false;
  return coreA.hasSeparator
    ? coreA.cut === coreB.full
    : coreB.cut === coreA.full;
}

type StockistDisplayRow = {
  id: string;
  name: string;
  regionLabel: string | null;
  address: string | null;
  url: string | null;
  sourceUrl?: string | null;
  fetchedAt?: string | null;
  locationType?: string | null;
  country?: string | null;
  ownerStatus: string;
  /** `auth.users.id` of whoever set `ownerStatus`; null on backfilled rows. */
  ownerStatusBy?: string | null;
  source: string;
  removedAt: string | null;
};

export type StockistRegionGroup = {
  key: string;
  stockists: Stockist[];
};

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function sortStockistsForDisplay(a: Stockist, b: Stockist): number {
  const statusOrder =
    Number(a.status !== "confirmed") - Number(b.status !== "confirmed");
  if (statusOrder !== 0) return statusOrder;

  return compareText(a.name, b.name);
}

function regionLabelToSlug(regionLabel: string): string | null {
  return REGION_SLUG_BY_LABEL[regionLabel] ?? null;
}

export function groupStockistsByRegion(
  stockists: Stockist[],
): StockistRegionGroup[] {
  const grouped = new Map<string, Stockist[]>();

  for (const stockist of stockists) {
    const regionSlug = stockist.regionLabel
      ? regionLabelToSlug(stockist.regionLabel)
      : null;
    // Three buckets, and `overseas` is the fallback. It is honest only for a
    // row whose region really is outside Taiwan or unmappable. A region-LESS
    // row lands here too, and for that row it is a false claim: the submit
    // dialog offers Taiwan regions only, which is why it now requires one
    // (`provide-stockist-info-dialog.tsx`). Imported and backfilled rows can
    // still carry `region_label: null` and will read as 海外 on the brand page
    // until one is supplied.
    // Every stockist is a physical place since DEV-1513, so there is no online
    // bucket to divert into.
    const key =
      stockist.country != null && stockist.country !== "TW"
        ? "overseas"
        : stockist.regionLabel === CHAIN_REGION_LABEL
          ? "all_taiwan"
          : (regionSlug ?? "overseas");
    const group = grouped.get(key) ?? [];
    group.push(stockist);
    grouped.set(key, group);
  }

  return [...grouped.entries()]
    .map(([key, group]) => ({
      key,
      stockists: [...group].sort(sortStockistsForDisplay),
    }))
    .sort(
      (left, right) =>
        right.stockists.length - left.stockists.length ||
        compareText(left.key, right.key),
    );
}

/**
 * What separates 品牌確認 from 站方確認 is now `owner_status_by` alone: every
 * write path since 2026-07 records the approver, and brand ownership was parked
 * with the claim flow (DEV-1570), so a recorded approver is by definition
 * Formoria rather than the brand. Only the approver-less rows of the 2026-07
 * backfill still carry the 品牌確認 claim.
 */
export function groupStockistsForDisplay(
  rows: Array<StockistDisplayRow>,
): { confirmed: Stockist[]; possible: Stockist[] } {
  const confirmed: Stockist[] = [];
  const possible: Stockist[] = [];

  for (const row of rows) {
    if (row.removedAt !== null || row.ownerStatus === "rejected") continue;

    const ownerConfirmed = row.ownerStatus === "confirmed";
    // A null `ownerStatusBy` is the 2026-07 backfill, which copied genuine owner
    // confirmations out of `brands.retail_locations` without recording who made
    // them; reading that silence as "Formoria said so" would invent a false
    // claim, so it keeps the owner attribution. A recorded approver is an admin.
    const approvedByNonOwner = ownerConfirmed && row.ownerStatusBy != null;
    const evidenceBacked = row.sourceUrl != null && row.source !== "community";
    // The public label for evidence-backed rows is a trust claim, so it may only
    // say "from the official website" when the evidence really is the brand's
    // own site. `brand_channels` has no source_type column, so `source` is the
    // only field that carries that guarantee: the curated stockist import
    // (scripts/enrichment/data/stockist-import/plan.ts) publishes a row ONLY when its CSV
    // source_type is `official_website`. Every other evidence-backed source
    // (enriched, backfill, admin, owner) may cite a directory, a social post or
    // a retailer page, so it gets the generic source-attested label instead.
    const evidenceSource: Stockist["evidenceSource"] =
      row.source === "import" ? "official_website" : "other";
    const status: Stockist["status"] =
      ownerConfirmed || evidenceBacked ? "confirmed" : "unconfirmed";
    const stockist: Stockist = {
      id: row.id,
      name: row.name,
      regionLabel: row.regionLabel,
      address: row.address,
      url: row.url,
      fetchedAt: row.fetchedAt ?? null,
      locationType: (row.locationType as Stockist["locationType"]) ?? null,
      country: row.country ?? null,
      ownerStatus: row.ownerStatus as Stockist["ownerStatus"],
      source: row.source as Stockist["source"],
      status,
      ...(status === "confirmed"
        ? {
            confirmedBy: ownerConfirmed
              ? approvedByNonOwner
                ? ("formoria" as const)
                : ("owner" as const)
              : ("evidence" as const),
          }
        : {}),
      ...(status === "confirmed" && !ownerConfirmed && evidenceBacked
        ? { evidenceSource }
        : {}),
    };

    if (status === "confirmed") {
      confirmed.push(stockist);
    } else {
      possible.push(stockist);
    }
  }

  return { confirmed, possible };
}
