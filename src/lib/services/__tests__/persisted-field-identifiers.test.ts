import { describe, expect, it } from "vitest";
import { mergePersistedFieldStates } from "../_shared/persisted-field-identifiers";

describe("persisted field state translation", () => {
  // Bug caught: expanding product_tags and product_tags_en with
  // Object.fromEntries made an enriched English row erase an owner lock when
  // Postgres returned the pair in that order.
  it.each([
    [
      "owner row first",
      [
        {
          field: "product_tags",
          source: "owner",
          updated_at: "2026-08-18T01:00:00.000Z",
        },
        {
          field: "product_tags_en",
          source: "enriched",
          updated_at: "2026-08-18T02:00:00.000Z",
        },
      ],
    ],
    [
      "enriched row first",
      [
        {
          field: "product_tags_en",
          source: "enriched",
          updated_at: "2026-08-18T02:00:00.000Z",
        },
        {
          field: "product_tags",
          source: "owner",
          updated_at: "2026-08-18T01:00:00.000Z",
        },
      ],
    ],
  ])("owner provenance wins regardless of row order: %s", (_label, rows) => {
    expect(mergePersistedFieldStates(rows)).toEqual({
      subcategories: {
        source: "owner",
        updatedAt: "2026-08-18T01:00:00.000Z",
      },
      subcategories_en: {
        source: "owner",
        updatedAt: "2026-08-18T01:00:00.000Z",
      },
    });
  });
});
