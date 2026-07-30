import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { describeWithDb } from "@/test/setup";
import { normalizeCommunityWebsite } from "../community-submissions";

const supabase =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
      )
    : null;

describeWithDb("brand duplicate checks", () => {
  const brandIds: string[] = [];

  afterEach(async () => {
    if (brandIds.length === 0) return;
    await supabase!.from("brands").delete().in("id", brandIds);
    brandIds.length = 0;
  });

  it("finds website variants without collapsing distinct storefront paths", async () => {
    const brandId = randomUUID();
    brandIds.push(brandId);
    const { error } = await supabase!.from("brands").insert({
      id: brandId,
      name: "María García Ceramics",
      slug: `maria-garcia-ceramics-${brandId}`,
      status: "approved",
      purchase_website: "https://www.maria-garcia.example/store/",
    });
    if (error) throw error;

    for (const website of [
      "http://maria-garcia.example/store",
      "https://www.maria-garcia.example/store/",
      "https://maria-garcia.example/store",
      "https://maria-garcia.example/store/?utm_source=ig#collection",
    ]) {
      const websiteKey = normalizeCommunityWebsite(website)?.key;
      const { data, error: rpcError } = await supabase!.rpc(
        "check_brand_duplicates",
        {
          p_name: "Completely Different Studio",
          p_website_key: websiteKey,
        },
      );
      expect(rpcError).toBeNull();
      expect(data).toMatchObject({
        website_matches: [
          expect.objectContaining({
            id: brandId,
            slug: `maria-garcia-ceramics-${brandId}`,
          }),
        ],
      });
    }

    const differentStorefrontKey = normalizeCommunityWebsite(
      "https://maria-garcia.example/another-store",
    )?.key;
    const { data } = await supabase!.rpc("check_brand_duplicates", {
      p_name: "Another Different Studio",
      p_website_key: differentStorefrontKey,
    });
    expect(data).toMatchObject({ website_matches: [] });
  });

  it("warns on a likely typo without treating a shared generic word as a similar brand", async () => {
    const typoBrandId = randomUUID();
    const genericBrandId = randomUUID();
    brandIds.push(typoBrandId, genericBrandId);
    const { error } = await supabase!.from("brands").insert([
      {
        id: typoBrandId,
        name: "AROMASE 艾瑪絲",
        slug: `aromase-${typoBrandId}`,
        status: "approved",
      },
      {
        id: genericBrandId,
        name: "STUDIO M'",
        slug: `studio-m-${genericBrandId}`,
        status: "approved",
      },
    ]);
    if (error) throw error;

    const { data, error: rpcError } = await supabase!.rpc(
      "find_similar_brands",
      {
        p_names: ["AROMASE 艾瑪斯", "MASTER PROJECT STUDIO"],
        p_threshold: 0.6,
      },
    );

    expect(rpcError).toBeNull();
    expect(data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          input_name: "AROMASE 艾瑪斯",
          brand_slug: `aromase-${typoBrandId}`,
        }),
      ]),
    );
    expect(data).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          input_name: "MASTER PROJECT STUDIO",
          brand_slug: `studio-m-${genericBrandId}`,
        }),
      ]),
    );
  });
});
