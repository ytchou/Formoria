import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

import en from "../../../../messages/en.json";
import type { Database } from "@/lib/supabase/database.types";
import { describeWithDb } from "@/test/setup";
import {
  getChannelsForBrand,
  listPendingCommunityStockists,
  reviewCommunityStockist,
} from "../brand-channels";

const supabase =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
      )
    : null;

/**
 * The admin queue is the ONLY way a reader-submitted stockist becomes public:
 * DEV-1513 removed the community-confirmation path, so a pending row is
 * invisible everywhere until an admin decides on it.
 *
 * Against a real database, not a fake: these functions build their own service
 * client and `check-test-boundaries.mjs` forbids mocking it. The static half of
 * the contract — that every public read applies the filter at all — is asserted
 * in `brand-channels.test.ts`.
 */
describeWithDb("admin stockist queue", () => {
  const brandIds: string[] = [];

  async function seedBrand(): Promise<string> {
    const brandId = randomUUID();
    brandIds.push(brandId);
    // The `[E2E-TEST]` prefix keeps the row out of every public listing even if
    // a cleanup fails — see `TEST_BRAND_NAME_PATTERN`.
    const { error } = await supabase!.from("brands").insert({
      id: brandId,
      name: `[E2E-TEST] Stockist queue ${brandId}`,
      slug: `stockist-queue-${brandId}`,
      status: "approved",
    });
    if (error) throw error;
    return brandId;
  }

  async function seedChannel(
    brandId: string,
    row: {
      name: string;
      source: string;
      ownerStatus: string;
      ownerStatusBy?: string | null;
      removedAt?: string | null;
    },
  ): Promise<string> {
    const channelId = randomUUID();
    const { error } = await supabase!.from("brand_channels").insert({
      id: channelId,
      brand_id: brandId,
      name: row.name,
      normalized_name: `${row.name}-${channelId}`.slice(0, 80),
      region_label: "臺北市",
      source: row.source,
      owner_status: row.ownerStatus,
      owner_status_by: row.ownerStatusBy ?? null,
      removed_at: row.removedAt ?? null,
    });
    if (error) throw error;
    return channelId;
  }

  /**
   * Any existing auth user. `owner_status_by` is a real FK to `auth.users`, so
   * a fabricated uuid fails the constraint and the write reports
   * `database_error` — which would make the provenance assertions below pass or
   * fail for the wrong reason.
   */
  async function anyUserId(): Promise<string> {
    const { data, error } = await supabase!.auth.admin.listUsers({
      page: 1,
      perPage: 1,
    });
    if (error) throw error;
    const user = data.users.at(0);
    if (!user) throw new Error("Integration database has no auth user to act as an approver");
    return user.id;
  }

  afterEach(async () => {
    if (brandIds.length === 0) return;
    await supabase!.from("brand_channels").delete().in("brand_id", brandIds);
    await supabase!.from("brand_owners").delete().in("brand_id", brandIds);
    await supabase!.from("brands").delete().in("id", brandIds);
    brandIds.length = 0;
  });

  it("lists only pending community rows", async () => {
    const brandId = await seedBrand();
    const pendingId = await seedChannel(brandId, {
      name: "待審核社群通路",
      source: "community",
      ownerStatus: "none",
    });
    await seedChannel(brandId, {
      name: "品牌已確認的社群通路",
      source: "community",
      ownerStatus: "confirmed",
    });
    await seedChannel(brandId, {
      name: "匯入的通路",
      source: "import",
      ownerStatus: "none",
    });
    await seedChannel(brandId, {
      name: "已移除的社群通路",
      source: "community",
      ownerStatus: "none",
      removedAt: new Date().toISOString(),
    });

    // Scoped to this brand: the queue is cross-brand by design, so a shared
    // database legitimately holds other pending rows.
    const pending = (await listPendingCommunityStockists()).filter(
      (stockist) => stockist.brandId === brandId,
    );

    expect(pending.map((stockist) => stockist.id)).toEqual([pendingId]);
    expect(pending.at(0)).toMatchObject({
      brandSlug: `stockist-queue-${brandId}`,
      name: "待審核社群通路",
    });
  });

  it("approving sets owner_status to confirmed", async () => {
    const brandId = await seedBrand();
    const channelId = await seedChannel(brandId, {
      name: "核准後應公開的通路",
      source: "community",
      ownerStatus: "none",
    });
    const adminUserId = await anyUserId();

    const result = await reviewCommunityStockist(
      channelId,
      "confirmed",
      adminUserId,
    );

    expect(result).toMatchObject({ ok: true, city: "taipei" });
    const { data } = await supabase!
      .from("brand_channels")
      .select("owner_status, owner_status_by")
      .eq("id", channelId)
      .maybeSingle();
    expect(data).toMatchObject({
      owner_status: "confirmed",
      owner_status_by: adminUserId,
    });
    // Decided, so it leaves the queue — and a second decision cannot land.
    expect(
      (await listPendingCommunityStockists()).filter(
        (stockist) => stockist.brandId === brandId,
      ),
    ).toEqual([]);
    expect(
      await reviewCommunityStockist(channelId, "rejected", adminUserId),
    ).toMatchObject({ ok: false, code: "not_found" });
  });

  it("rejecting sets owner_status to rejected", async () => {
    const brandId = await seedBrand();
    const channelId = await seedChannel(brandId, {
      name: "應被退回的通路",
      source: "community",
      ownerStatus: "none",
    });
    const adminUserId = await anyUserId();

    const result = await reviewCommunityStockist(
      channelId,
      "rejected",
      adminUserId,
    );

    expect(result).toMatchObject({ ok: true });
    const { data } = await supabase!
      .from("brand_channels")
      .select("owner_status, owner_status_by")
      .eq("id", channelId)
      .maybeSingle();
    expect(data).toMatchObject({
      owner_status: "rejected",
      owner_status_by: adminUserId,
    });
    // A rejected row is invisible on the brand page too, not merely dequeued.
    const channels = await getChannelsForBrand(brandId);
    expect([...channels.confirmed, ...channels.possible]).toEqual([]);
  });

  it("renders an empty state when nothing is pending", async () => {
    const brandId = await seedBrand();
    await seedChannel(brandId, {
      name: "匯入的通路，不需要審核",
      source: "import",
      ownerStatus: "none",
    });

    expect(
      (await listPendingCommunityStockists()).filter(
        (stockist) => stockist.brandId === brandId,
      ),
    ).toEqual([]);
    // An empty table with no sentence in it reads as a broken page. The queue
    // hands this string to `ReviewQueueTable`'s `emptyMessage`, so a missing key
    // would render the raw key path to the reviewer.
    expect(en.admin.stockists.empty).toEqual(expect.any(String));
    expect(en.admin.stockists.empty.length).toBeGreaterThan(0);
  });

  it("admin approval renders as Formoria provenance, not brand provenance", async () => {
    // 品牌確認 claims the BRAND said so. An admin approving a stranger's
    // submission has not made the brand say anything, and `owner_status_by` is
    // the only field that tells the two apart.
    const approverId = await anyUserId();

    const adminBrandId = await seedBrand();
    await seedChannel(adminBrandId, {
      name: "站方核准的通路",
      source: "community",
      ownerStatus: "confirmed",
      ownerStatusBy: approverId,
    });

    const ownedBrandId = await seedBrand();
    const { error: ownerError } = await supabase!
      .from("brand_owners")
      .insert({ brand_id: ownedBrandId, user_id: approverId });
    if (ownerError) throw ownerError;
    await seedChannel(ownedBrandId, {
      name: "品牌自己確認的通路",
      source: "community",
      ownerStatus: "confirmed",
      ownerStatusBy: approverId,
    });

    const [adminChannels, ownedChannels] = await Promise.all([
      getChannelsForBrand(adminBrandId),
      getChannelsForBrand(ownedBrandId),
    ]);

    expect(adminChannels.confirmed.at(0)).toMatchObject({
      confirmedBy: "formoria",
    });
    // Same approver, same row shape — only the ownership row differs.
    expect(ownedChannels.confirmed.at(0)).toMatchObject({
      confirmedBy: "owner",
    });
  });
});
