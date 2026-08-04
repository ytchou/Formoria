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

  it("matches a CJK segment inside a mixed-script brand name", async () => {
    const brandId = randomUUID();
    brandIds.push(brandId);
    const { error } = await supabase!.from("brands").insert({
      id: brandId,
      name: `O!Terrific 歐特莉菲 ${brandId}`,
      slug: `o-terrific-${brandId}`,
      status: "approved",
    });
    if (error) throw error;

    const { data, error: rpcError } = await supabase!.rpc(
      "check_brand_duplicates",
      { p_name: "歐特莉菲" },
    );

    expect(rpcError).toBeNull();
    // arrayContaining, not an exact array: the real corpus holds the live
    // `O!Terrific 歐特莉菲` this bug was reported against, and it matches too.
    expect(data).toMatchObject({
      name_matches: expect.arrayContaining([
        expect.objectContaining({ id: brandId, matched_on: "cjk" }),
      ]),
    });
  });

  it("does not match short segments by containment", async () => {
    // `Bonbons` / `Bon Bon Stickers 邦妮插畫` is deliberately absent: the
    // unchanged whole-name rule scores it 0.857 on `word_similarity` and flags
    // it today, independent of the segment rules. Asserting no-match there
    // would be asserting a behaviour change this fix does not make.
    const cases = [
      ["Mountopia® 山托邦", "山織 Mount"],
      ["Landingdream", "Lan（美味茶葉蛋）"],
      ["PNGL 穿山甲", "雱PĀNG"],
    ] as const;
    const seeded = cases.map(([name]) => ({ id: randomUUID(), name }));
    brandIds.push(...seeded.map(({ id }) => id));
    // Seeded verbatim, with the uuid confined to the slug: appending it to the
    // name pads the Latin segment with 32 hex chars, which drags
    // `similarity('mount', 'mountopia…')` far below the threshold and makes the
    // containment cases pass for the wrong reason. The assertion is that the
    // *seeded* id is absent, so a live twin also matching is harmless.
    const { error } = await supabase!.from("brands").insert(
      seeded.map(({ id, name }) => ({
        id,
        name,
        slug: `duplicate-check-${id}`,
        status: "approved" as const,
      })),
    );
    if (error) throw error;

    for (const [index, [, query]] of cases.entries()) {
      const { data, error: rpcError } = await supabase!.rpc(
        "check_brand_duplicates",
        { p_name: query },
      );
      expect(rpcError).toBeNull();
      expect(data).not.toEqual(
        expect.objectContaining({
          name_matches: expect.arrayContaining([
            expect.objectContaining({ id: seeded[index].id }),
          ]),
        }),
      );
    }
  });

  it("matches a social profile website when purchase website is null", async () => {
    const brandId = randomUUID();
    const instagramPath = `formoria-${brandId}`;
    brandIds.push(brandId);
    const { error } = await supabase!.from("brands").insert({
      id: brandId,
      name: `Social Brand ${brandId}`,
      slug: `social-brand-${brandId}`,
      status: "approved",
      purchase_website: null,
      social_instagram: `https://www.instagram.com/${instagramPath}/`,
    });
    if (error) throw error;

    const websiteKey = normalizeCommunityWebsite(
      `https://www.instagram.com/${instagramPath}/`,
    )?.key;
    const { data, error: rpcError } = await supabase!.rpc(
      "check_brand_duplicates",
      { p_name: "Unrelated Brand", p_website_key: websiteKey },
    );

    expect(rpcError).toBeNull();
    expect(data).toMatchObject({
      website_matches: [
        expect.objectContaining({ id: brandId, matched_on: "website" }),
      ],
    });
  });

  it("matches mixed-script names regardless of word order", async () => {
    const brandId = randomUUID();
    brandIds.push(brandId);
    const { error } = await supabase!.from("brands").insert({
      id: brandId,
      name: `SH Taiwan 植茁 ${brandId}`,
      slug: `sh-taiwan-${brandId}`,
      status: "approved",
    });
    if (error) throw error;

    const { data, error: rpcError } = await supabase!.rpc(
      "check_brand_duplicates",
      { p_name: "植茁 Zhi Grow" },
    );

    expect(rpcError).toBeNull();
    // Both `植茁 Zhi Grow` and `SH Taiwan 植茁` are live brands, so the seeded row
    // is one of several legitimate hits.
    expect(data).toMatchObject({
      name_matches: expect.arrayContaining([
        expect.objectContaining({ id: brandId }),
      ]),
    });
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
