import { describe, expect, it } from "vitest";

import {
  CORRECTION_FIELDS,
  isCorrectionField,
} from "@/lib/services/brand-corrections";
import { correctionInputSchema } from "../brand-corrections-core";

/**
 * The action's zod gate decides which corrections are reachable at all, and it
 * used to be a second, hand-maintained copy of the correctable field set built
 * with an `as unknown as` tuple assertion — so TypeScript could not report a
 * member the tuple forgot. `material` shipped in the type, the service, the RPC
 * and the DB CHECK while the schema still rejected it, and the only caller
 * could never submit one.
 *
 * The gate now reads `CORRECTION_FIELDS`, the service's own runtime vocabulary.
 * These assertions drive off that same list rather than re-listing the fields,
 * so they keep holding as fields are added and fail the moment the gate is
 * hand-written again and drops one.
 */

const BRAND_ID = "11111111-2222-4333-8444-555555555555";
const ARRAY_VALUED_FIELDS = ["subcategories", "material"] as const;

/**
 * A payload shaped for the field, so a rejection can only come from the field
 * gate. The two array-valued fields take a delta; every other field is scalar.
 */
function proposedValueFor(field: string): unknown {
  return (ARRAY_VALUED_FIELDS as readonly string[]).includes(field)
    ? { add: ["ceramics"], remove: [] }
    : "https://example.com/brand";
}

function accepts(field: string): boolean {
  return correctionInputSchema.safeParse({
    brandId: BRAND_ID,
    field,
    proposedValue: proposedValueFor(field),
  }).success;
}

describe("correctionInputSchema field gate", () => {
  it("accepts the material delta the shipped gate used to reject", () => {
    const parsed = correctionInputSchema.safeParse({
      brandId: BRAND_ID,
      field: "material",
      proposedValue: { add: ["ceramics"], remove: ["wood"] },
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.field).toBe("material");
    expect(parsed.success && parsed.data.proposedValue).toEqual({
      add: ["ceramics"],
      remove: ["wood"],
    });
  });

  it("accepts every field the service can correct", () => {
    const rejected = CORRECTION_FIELDS.filter((field) => !accepts(field));

    expect(rejected).toEqual([]);
  });

  it("accepts exactly the service vocabulary, no more", () => {
    // `.options` is what the enum will actually admit at runtime; comparing it
    // to the service list catches a gate that grows a member the service does
    // not correct as well as one that drops a member it does.
    expect([...correctionInputSchema.shape.field.options].sort()).toEqual(
      [...CORRECTION_FIELDS].sort(),
    );
    for (const field of correctionInputSchema.shape.field.options) {
      expect(isCorrectionField(field)).toBe(true);
    }
  });

  it("rejects a brand column the service does not correct", () => {
    // `name` is a real column and a plausible hand-written payload, and it is
    // not correctable: the gate has to be the thing that says so.
    expect(isCorrectionField("name")).toBe(false);
    expect(accepts("name")).toBe(false);
  });

  it("rejects a delta payload that is neither a string, a number nor a delta", () => {
    expect(
      correctionInputSchema.safeParse({
        brandId: BRAND_ID,
        field: "material",
        proposedValue: ["ceramics"],
      }).success,
    ).toBe(false);
  });

  it("rejects a brand id that is not a uuid", () => {
    expect(
      correctionInputSchema.safeParse({
        brandId: "not-a-uuid",
        field: "material",
        proposedValue: { add: ["ceramics"], remove: [] },
      }).success,
    ).toBe(false);
  });
});
