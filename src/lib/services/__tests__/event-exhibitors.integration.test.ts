import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import type { Brand } from "@/lib/types";
import { createTestClient, describeWithDb } from "@/test/setup";
import {
  composeEventExhibitorEntries,
  fetchEventExhibitorBrandSlugs,
  fetchEventExhibitors,
} from "../events";

describeWithDb("event exhibitor manifest integration", () => {
  const supabase = (
    process.env.RUN_SUPABASE_INTEGRATION_TESTS === "true"
      ? createTestClient()
      : null
  )!;
  const eventIds: string[] = [];
  const brandIds: string[] = [];

  afterEach(async () => {
    if (eventIds.length > 0) {
      await supabase.from("events").delete().in("id", eventIds);
      eventIds.length = 0;
    }
    if (brandIds.length > 0) {
      await supabase.from("brands").delete().in("id", brandIds);
      brandIds.length = 0;
    }
  });

  it("keeps linked, unlinked, and hidden-brand exhibitors through repeated updates and safe pruning", async () => {
    // This is the bug journey: an official roster must remain complete while
    // brand links can be updated/pruned and hidden cards fall back to null.
    const eventId = randomUUID();
    const approvedBrandId = randomUUID();
    const hiddenBrandId = randomUUID();
    const secondBrandId = randomUUID();
    const eventSlug = `event-exhibitor-integration-${eventId.slice(0, 8)}`;
    eventIds.push(eventId);
    brandIds.push(approvedBrandId, hiddenBrandId, secondBrandId);

    const { error: eventError } = await supabase.from("events").insert({
      id: eventId,
      slug: eventSlug,
      name: "Exhibitor integration event",
      summary: "Integration fixture",
      starts_on: "2026-08-06",
      ends_on: "2026-08-09",
      status: "published",
    });
    expect(eventError).toBeNull();
    const { error: brandError } = await supabase.from("brands").insert([
      {
        id: approvedBrandId,
        name: "María García Ceramics",
        slug: `integration-approved-${eventId.slice(0, 8)}`,
        status: "approved",
      },
      {
        id: hiddenBrandId,
        name: "Hidden Integration Brand",
        slug: `integration-hidden-${eventId.slice(0, 8)}`,
        status: "hidden",
      },
      {
        id: secondBrandId,
        name: "Second Integration Brand",
        slug: `integration-second-${eventId.slice(0, 8)}`,
        status: "approved",
      },
    ]);
    expect(brandError).toBeNull();

    const exhibitors = [
      {
        event_id: eventId,
        source_key: "creative-expo:test-001",
        name: "María García Ceramics",
        name_en: null,
        booth: "K1-001",
        area: "文創品牌展區",
        area_en: "Cultural & Creative Brands",
        zone: "K1",
        event_category: "cultural_creative",
        source_url: "https://example.com/k1-001",
        website_url: null,
        verified_at: "2026-08-06",
        sort_order: 0,
      },
      {
        event_id: eventId,
        source_key: "creative-expo:test-002",
        name: "Hidden Integration Brand",
        name_en: null,
        booth: "S-001",
        area: "新銳品牌展區",
        area_en: "Start-ups",
        zone: "S",
        event_category: "startups",
        source_url: "https://example.com/s-001",
        website_url: null,
        verified_at: "2026-08-06",
        sort_order: 1,
      },
      {
        event_id: eventId,
        source_key: "creative-expo:test-003",
        name: "Unlinked official exhibitor",
        name_en: null,
        booth: "K2-001",
        area: "文創品牌展區",
        area_en: "Cultural & Creative Brands",
        zone: "K2",
        event_category: "cultural_creative",
        source_url: "https://example.com/k2-001",
        website_url: null,
        verified_at: "2026-08-06",
        sort_order: 2,
      },
    ];
    const { data: insertedExhibitors, error: exhibitorError } = await supabase
      .from("event_exhibitors")
      .upsert(exhibitors, { onConflict: "event_id,source_key" })
      .select("id, source_key");
    expect(exhibitorError).toBeNull();
    expect(insertedExhibitors).toHaveLength(3);
    const idBySource = new Map(
      (insertedExhibitors ?? []).map((row) => [row.source_key, row.id]),
    );
    const { error: linksError } = await supabase.from("event_brands").upsert(
      [
        {
          event_id: eventId,
          brand_id: approvedBrandId,
          event_exhibitor_id: idBySource.get("creative-expo:test-001"),
          booth: "K1-001",
          area: "文創品牌展區",
          area_en: "Cultural & Creative Brands",
          sort_order: 0,
        },
        {
          event_id: eventId,
          brand_id: hiddenBrandId,
          event_exhibitor_id: idBySource.get("creative-expo:test-002"),
          booth: "S-001",
          area: "新銳品牌展區",
          area_en: "Start-ups",
          sort_order: 1,
        },
      ],
      { onConflict: "event_id,brand_id" },
    );
    expect(linksError).toBeNull();

    // Repeating the same upsert is logically idempotent; changing canonical
    // metadata updates one row rather than creating a duplicate source key.
    const { error: repeatError } = await supabase
      .from("event_exhibitors")
      .upsert(
        exhibitors.map((row) =>
          row.source_key === "creative-expo:test-001"
            ? { ...row, name: "María García Ceramics updated" }
            : row,
        ),
        { onConflict: "event_id,source_key" },
      );
    expect(repeatError).toBeNull();
    const { count: rosterCount } = await supabase
      .from("event_exhibitors")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId);
    expect(rosterCount).toBe(3);

    const links = await fetchEventExhibitorBrandSlugs(supabase, [
      ...idBySource.values(),
    ]);
    expect(links.size).toBe(2);
    const fetched = await fetchEventExhibitors(supabase, eventSlug);
    const { data: approvedRows } = await supabase
      .from("brands")
      .select("id, slug, name")
      .eq("id", approvedBrandId);
    const publicBrands = new Map(
      (approvedRows ?? []).map((row) => [row.slug, row as unknown as Brand]),
    );
    const entries = composeEventExhibitorEntries(fetched, links, publicBrands);
    expect(entries).toHaveLength(3);
    expect(
      entries.find((row) => row.sourceKey === "creative-expo:test-001")?.brand,
    ).toMatchObject({
      slug: `integration-approved-${eventId.slice(0, 8)}`,
    });
    expect(
      entries.find((row) => row.sourceKey === "creative-expo:test-002")?.brand,
    ).toBeNull();
    expect(
      entries.find((row) => row.sourceKey === "creative-expo:test-003")?.brand,
    ).toBeNull();

    // Removing one legacy link and stale exhibitor is safe only after the
    // canonical replacement rows exist.
    const staleExhibitorId = idBySource.get("creative-expo:test-003")!;
    const { error: pruneError } = await supabase
      .from("event_exhibitors")
      .delete()
      .eq("id", staleExhibitorId);
    expect(pruneError).toBeNull();
    const { count: afterPruneCount } = await supabase
      .from("event_exhibitors")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId);
    expect(afterPruneCount).toBe(2);

    // The partial unique index is the cardinality guard: one exhibitor cannot
    // be linked to a second Formoria brand in the same event.
    const { error: cardinalityError } = await supabase
      .from("event_brands")
      .insert({
        event_id: eventId,
        brand_id: secondBrandId,
        event_exhibitor_id: idBySource.get("creative-expo:test-001"),
        booth: "K1-001",
        sort_order: 9,
      });
    expect(cardinalityError).not.toBeNull();

    const secondEventId = randomUUID();
    eventIds.push(secondEventId);
    const { error: secondEventError } = await supabase.from("events").insert({
      id: secondEventId,
      slug: `event-exhibitor-cross-event-${secondEventId.slice(0, 8)}`,
      name: "Cross-event scope fixture",
      summary: "Integration fixture",
      starts_on: "2026-08-06",
      ends_on: "2026-08-09",
      status: "published",
    });
    expect(secondEventError).toBeNull();
    const { data: secondExhibitor, error: secondExhibitorError } =
      await supabase
        .from("event_exhibitors")
        .insert({
          event_id: secondEventId,
          source_key: "creative-expo:test-cross-event",
          name: "Cross-event exhibitor",
          booth: "K3-001",
          area: "文創品牌展區",
          area_en: "Cultural & Creative Brands",
          zone: "K3",
          event_category: "cultural_creative",
          source_url: "https://example.com/cross-event",
          verified_at: "2026-08-06",
          sort_order: 0,
        })
        .select("id")
        .single();
    expect(secondExhibitorError).toBeNull();
    expect(secondExhibitor).toBeTruthy();

    const { error: crossEventError } = await supabase
      .from("event_brands")
      .insert({
        event_id: eventId,
        brand_id: secondBrandId,
        event_exhibitor_id: secondExhibitor?.id,
        booth: "K3-001",
        sort_order: 10,
      });
    expect(crossEventError).not.toBeNull();
  });
});
