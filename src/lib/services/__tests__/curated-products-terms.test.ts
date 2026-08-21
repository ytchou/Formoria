import { beforeEach, describe, expect, it } from "vitest";
import { setAuditWriteSeam, type AuditRecord } from "@/lib/audit";
import {
  createCuratedProduct,
  updateCuratedProduct,
  type CuratedProductSupabase,
} from "../curated-products";

/**
 * DEV-1543 write-path vocabulary gate for `curated_products`.
 *
 * Create and update must behave identically on the two zh columns the site
 * publishes, and the sparse update payload must stay sparse — a key the caller
 * never supplied may not appear, because `product_description_zh` is NOT NULL
 * and an introduced null would be a 23502.
 *
 * The client is INJECTED, never mocked (`scripts/check-test-boundaries.mjs`).
 */

const BRAND_ID = "22222222-2222-2222-2222-222222222222";
const PRODUCT_ID = "11111111-1111-1111-1111-111111111111";

const BANNED = "質量";
const CORRECTED = "品質";

type Payload = Record<string, unknown>;

let inserts: Payload[] = [];
let updates: Payload[] = [];
let auditRecords: AuditRecord[] = [];

function clientDouble(): CuratedProductSupabase {
  const double = {
    from(table: string) {
      if (table !== "curated_products") {
        throw new Error(`unexpected table: ${table}`);
      }
      const chain = {
        insert(payload: Payload) {
          inserts.push(payload);
          return {
            select: () => ({
              single: async () => ({
                data: { id: PRODUCT_ID, key: payload.key },
                error: null,
              }),
            }),
          };
        },
        update(payload: Payload) {
          updates.push(payload);
          return { eq: async () => ({ error: null }) };
        },
      };
      return chain;
    },
  };
  return double as unknown as CuratedProductSupabase;
}

function recordedFixes(): Array<Record<string, unknown>> {
  return auditRecords.flatMap((record) => {
    const fixes = record.summary?.bannedTermFixes;
    return Array.isArray(fixes)
      ? (fixes as Array<Record<string, unknown>>)
      : [];
  });
}

beforeEach(() => {
  inserts = [];
  updates = [];
  auditRecords = [];
  setAuditWriteSeam(async (record) => {
    auditRecords.push(record);
    return null;
  });
});

describe("createCuratedProduct vocabulary guard", () => {
  it("corrects product_description_zh and name_zh", async () => {
    await createCuratedProduct(
      {
        brandId: BRAND_ID,
        nameZh: `高${BANNED}保溫瓶`,
        category: "home",
        productDescriptionZh: `做工的${BANNED}很穩定。`,
      },
      clientDouble(),
    );

    expect(inserts).toHaveLength(1);
    const row = inserts[0] as Record<string, string>;
    expect(row.name_zh).toBe(`高${CORRECTED}保溫瓶`);
    expect(row.product_description_zh).toBe(`做工的${CORRECTED}很穩定。`);
    expect(JSON.stringify(row)).not.toContain(BANNED);

    expect(recordedFixes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "name_zh", term: BANNED }),
        expect.objectContaining({
          field: "product_description_zh",
          term: BANNED,
        }),
      ]),
    );
  });

  it("leaves clean text untouched", async () => {
    const nameZh = `高${CORRECTED}保溫瓶`;
    const productDescriptionZh = `做工的${CORRECTED}很穩定。`;

    await createCuratedProduct(
      {
        brandId: BRAND_ID,
        nameZh,
        category: "home",
        productDescriptionZh,
      },
      clientDouble(),
    );

    const row = inserts[0] as Record<string, string>;
    expect(row.name_zh).toBe(nameZh);
    expect(row.product_description_zh).toBe(productDescriptionZh);
    expect(recordedFixes()).toEqual([]);
  });
});

describe("updateCuratedProduct vocabulary guard", () => {
  it("applies the same guard", async () => {
    await updateCuratedProduct(
      PRODUCT_ID,
      {
        nameZh: `高${BANNED}保溫瓶`,
        productDescriptionZh: `做工的${BANNED}很穩定。`,
      },
      clientDouble(),
    );

    expect(updates).toHaveLength(1);
    const payload = updates[0] as Record<string, string>;
    expect(payload.name_zh).toBe(`高${CORRECTED}保溫瓶`);
    expect(payload.product_description_zh).toBe(`做工的${CORRECTED}很穩定。`);

    expect(recordedFixes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "name_zh", term: BANNED }),
        expect.objectContaining({
          field: "product_description_zh",
          term: BANNED,
        }),
      ]),
    );
  });

  it("keeps the payload sparse — an unsupplied zh column is never introduced", async () => {
    await updateCuratedProduct(
      PRODUCT_ID,
      { nameZh: `高${BANNED}保溫瓶` },
      clientDouble(),
    );

    const payload = updates[0] ?? {};
    expect(Object.keys(payload)).toEqual(["name_zh"]);
    expect("product_description_zh" in payload).toBe(false);
  });
});
