import type { BrandChannel } from "@/lib/types/brand-channel";
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
 * Deliberately NOT `<Q extends PublicChannelQuery<Q>>`. A self-referential
 * constraint makes tsc structurally re-check the whole PostgREST builder once
 * per method, and three methods against `.select(CHANNEL_READ_SELECT)` exceeds
 * the instantiation depth limit (TS2589). `excludeTestBrands` gets away with
 * the recursive form because it constrains exactly one method.
 */
type PublicChannelQuery = {
  is(column: string, value: null): PublicChannelQuery;
  neq(column: string, value: string): PublicChannelQuery;
  or(filters: string): PublicChannelQuery;
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
export function applyPublicChannelVisibility<Q>(query: Q): Q {
  return (query as PublicChannelQuery)
    .is("removed_at", null)
    .neq("owner_status", "rejected")
    .or(PENDING_COMMUNITY_EXCLUSION) as Q;
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

export function normalizeChannelName(name: string): string {
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

type ChannelRow = {
  id: string;
  name: string;
  channelType: string;
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

export type ChannelRegionGroup = {
  key: string;
  channels: BrandChannel[];
};

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function sortChannelsForDisplay(a: BrandChannel, b: BrandChannel): number {
  const statusOrder =
    Number(a.status !== "confirmed") - Number(b.status !== "confirmed");
  if (statusOrder !== 0) return statusOrder;

  return compareText(a.name, b.name);
}

function regionLabelToSlug(regionLabel: string): string | null {
  return REGION_SLUG_BY_LABEL[regionLabel] ?? null;
}

export function groupChannelsByRegion(
  channels: BrandChannel[],
): ChannelRegionGroup[] {
  const grouped = new Map<string, BrandChannel[]>();

  for (const channel of channels) {
    const regionSlug = channel.regionLabel
      ? regionLabelToSlug(channel.regionLabel)
      : null;
    const key =
      channel.channelType === "online"
        ? "online"
        : channel.country != null && channel.country !== "TW"
          ? "overseas"
          : channel.regionLabel === CHAIN_REGION_LABEL
            ? "all_taiwan"
            : (regionSlug ?? "overseas");
    const group = grouped.get(key) ?? [];
    group.push(channel);
    grouped.set(key, group);
  }

  return [...grouped.entries()]
    .map(([key, group]) => ({
      key,
      channels: [...group].sort(sortChannelsForDisplay),
    }))
    .sort((left, right) => {
      if (left.key === "online") return 1;
      if (right.key === "online") return -1;
      return (
        right.channels.length - left.channels.length ||
        compareText(left.key, right.key)
      );
    });
}

export function groupChannelsForDisplay(
  rows: Array<ChannelRow>,
  /**
   * `auth.users.id` of every owner of the brand these rows belong to. It is what
   * separates 品牌確認 from 站方確認: an admin approving a community submission
   * sets the same `owner_status = 'confirmed'` the brand's own owner does.
   */
  brandOwnerUserIds: readonly string[] = [],
): { confirmed: BrandChannel[]; possible: BrandChannel[] } {
  const brandOwnerUserIdSet = new Set(brandOwnerUserIds);
  const confirmed: BrandChannel[] = [];
  const possible: BrandChannel[] = [];

  for (const row of rows) {
    if (row.removedAt !== null || row.ownerStatus === "rejected") continue;

    const ownerConfirmed = row.ownerStatus === "confirmed";
    // Only a POSITIVELY identified non-owner downgrades the claim. A null
    // `ownerStatusBy` is the 2026-07 backfill, which copied genuine owner
    // confirmations out of `brands.retail_locations` without recording who made
    // them; reading that silence as "Formoria said so" would invent a different
    // false claim. Every write path since records the approver.
    const approvedByNonOwner =
      ownerConfirmed &&
      row.ownerStatusBy != null &&
      !brandOwnerUserIdSet.has(row.ownerStatusBy);
    const evidenceBacked = row.sourceUrl != null && row.source !== "community";
    // The public label for evidence-backed rows is a trust claim, so it may only
    // say "from the official website" when the evidence really is the brand's
    // own site. `brand_channels` has no source_type column, so `source` is the
    // only field that carries that guarantee: the curated stockist import
    // (scripts/stockist-import/plan.ts) publishes a row ONLY when its CSV
    // source_type is `official_website`. Every other evidence-backed source
    // (enriched, backfill, admin, owner) may cite a directory, a social post or
    // a retailer page, so it gets the generic source-attested label instead.
    const evidenceSource: BrandChannel["evidenceSource"] =
      row.source === "import" ? "official_website" : "other";
    const status: BrandChannel["status"] =
      ownerConfirmed || evidenceBacked ? "confirmed" : "unconfirmed";
    const channel: BrandChannel = {
      id: row.id,
      name: row.name,
      channelType: row.channelType as BrandChannel["channelType"],
      regionLabel: row.regionLabel,
      address: row.address,
      url: row.url,
      fetchedAt: row.fetchedAt ?? null,
      locationType: (row.locationType as BrandChannel["locationType"]) ?? null,
      country: row.country ?? null,
      ownerStatus: row.ownerStatus as BrandChannel["ownerStatus"],
      source: row.source as BrandChannel["source"],
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
      confirmed.push(channel);
    } else {
      possible.push(channel);
    }
  }

  return { confirmed, possible };
}
