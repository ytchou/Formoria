import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestClient } from "@/test/setup";
import { getStockistDirectory, type StockistLocation } from "../brand-channels";

const describeWithStockistDb =
  process.env.RUN_SUPABASE_INTEGRATION_TESTS === "1" ||
  process.env.RUN_SUPABASE_INTEGRATION_TESTS === "true"
    ? describe
    : describe.skip;
const integrationEnabled =
  process.env.RUN_SUPABASE_INTEGRATION_TESTS === "1" ||
  process.env.RUN_SUPABASE_INTEGRATION_TESTS === "true";

describeWithStockistDb("stockist directory public read", () => {
  const supabase = (integrationEnabled ? createTestClient() : null)!;
  const suffix = randomUUID().replaceAll("-", "");
  const brandIds: string[] = [];
  let locations: StockistLocation[] = [];

  beforeAll(async () => {
    const brands = [
      {
        id: randomUUID(),
        name: `María García Field Goods ${suffix}`,
        slug: `maria-garcia-field-goods-${suffix}`,
        status: "approved",
        product_type: "outdoor",
        product_tags: ["登山背包"],
      },
      {
        id: randomUUID(),
        name: `Private Atelier ${suffix}`,
        slug: `private-atelier-${suffix}`,
        status: "hidden",
      },
      {
        id: randomUUID(),
        name: `[E2E-TEST] Browser Fixture ${suffix}`,
        slug: `browser-fixture-${suffix}`,
        status: "approved",
      },
    ];
    brandIds.push(...brands.map((brand) => brand.id));
    const { error: brandError } = await supabase.from("brands").insert(brands);
    expect(brandError).toBeNull();

    const channels = [
      {
        brand_id: brands[0].id,
        name: `山徑選物 中山館 ${suffix}`,
        normalized_name: `mountain-path-zhongshan-${suffix}`,
        channel_type: "offline",
        region_label: "臺北市",
        district: "中山區",
        address: "臺北市中山區樂群二路199號2樓",
        country: "TW",
        source: "import",
      },
      {
        brand_id: brands[1].id,
        name: `隱藏品牌門市 ${suffix}`,
        normalized_name: `hidden-shop-${suffix}`,
        channel_type: "offline",
        region_label: "臺北市",
        district: "中山區",
        address: "臺北市中山區南京東路一段1號",
        country: "TW",
        source: "import",
      },
      {
        brand_id: brands[2].id,
        name: `瀏覽器測試門市 ${suffix}`,
        normalized_name: `browser-shop-${suffix}`,
        channel_type: "offline",
        region_label: "臺北市",
        district: "信義區",
        address: "臺北市信義區松高路11號",
        country: "TW",
        source: "import",
      },
      {
        brand_id: brands[0].id,
        name: `已移除門市 ${suffix}`,
        normalized_name: `removed-shop-${suffix}`,
        channel_type: "offline",
        region_label: "臺北市",
        district: "信義區",
        address: "臺北市信義區松仁路100號",
        country: "TW",
        source: "import",
        removed_at: new Date().toISOString(),
      },
      {
        brand_id: brands[0].id,
        name: `店主拒絕門市 ${suffix}`,
        normalized_name: `rejected-shop-${suffix}`,
        channel_type: "offline",
        region_label: "臺北市",
        district: "信義區",
        address: "臺北市信義區市府路1號",
        country: "TW",
        source: "import",
        owner_status: "rejected",
      },
    ];
    const { error: channelError } = await supabase
      .from("brand_channels")
      .insert(channels);
    expect(channelError).toBeNull();
    locations = await getStockistDirectory();
  });

  afterAll(async () => {
    if (brandIds.length > 0) {
      await supabase.from("brand_channels").delete().in("brand_id", brandIds);
      await supabase.from("brands").delete().in("id", brandIds);
    }
  });

  it("excludes channels belonging to a non-approved brand", () => {
    expect(locations.some(({ name }) => name.startsWith("隱藏品牌門市"))).toBe(
      false,
    );
  });

  it("excludes channels belonging to an [E2E-TEST] brand", () => {
    expect(
      locations.some(({ name }) => name.startsWith("瀏覽器測試門市")),
    ).toBe(false);
  });

  it("excludes removed and owner-rejected channels", () => {
    expect(locations.some(({ name }) => name.startsWith("已移除門市"))).toBe(
      false,
    );
    expect(locations.some(({ name }) => name.startsWith("店主拒絕門市"))).toBe(
      false,
    );
  });

  it("returns brand slug and name alongside each location", () => {
    expect(
      locations.find(({ name }) => name.startsWith("山徑選物 中山館")),
    ).toMatchObject({
      brandName: expect.stringContaining("María García Field Goods"),
      brandSlug: expect.stringContaining("maria-garcia-field-goods"),
    });
  });

  it("groups by city and district", () => {
    const counts = locations.reduce<Record<string, number>>(
      (result, location) => {
        const key = `${location.city}:${location.district}`;
        result[key] = (result[key] ?? 0) + 1;
        return result;
      },
      {},
    );
    expect(counts["taipei:中山區"]).toBeGreaterThanOrEqual(1);
  });
});
