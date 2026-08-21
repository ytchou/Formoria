import { beforeEach, describe, expect, it } from "vitest";
import { setAuditWriteSeam, type AuditRecord } from "@/lib/audit";
import {
  createCuratedProduct,
  updateCuratedProduct,
  type CuratedProductSupabase,
} from "../curated-products";

/**
 * DEV-1546 write-path vocabulary REPORT for `curated_products`.
 *
 * Create and update detect and never mutate: the stored text is byte-identical
 * to what the author or model wrote, and the finding goes to the audit span.
 * 質量 below is the case that made this necessary — it is the physics term for
 * mass, correct zh-TW, and the mutating guard rewrote it to 品質.
 *
 * The sparse update payload must still stay sparse — a key the caller never
 * supplied may not appear, because `product_description_zh` is NOT NULL and an
 * introduced null would be a 23502.
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

function recordedHits(): Array<Record<string, unknown>> {
  return auditRecords.flatMap((record) => {
    const fixes = record.summary?.bannedTerms;
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

describe("createCuratedProduct vocabulary report", () => {
  it("stores name_zh and product_description_zh unchanged and records both hits", async () => {
    const nameZh = `高${BANNED}保溫瓶`;
    const productDescriptionZh = `做工的${BANNED}很穩定。`;

    await createCuratedProduct(
      {
        brandId: BRAND_ID,
        nameZh,
        category: "home",
        productDescriptionZh,
      },
      clientDouble(),
    );

    expect(inserts).toHaveLength(1);
    const row = inserts[0] as Record<string, string>;
    expect(row.name_zh).toBe(nameZh);
    expect(row.product_description_zh).toBe(productDescriptionZh);
    expect(JSON.stringify(row)).not.toContain(CORRECTED);

    expect(recordedHits()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "name_zh",
          term: BANNED,
          replacement: CORRECTED,
        }),
        expect.objectContaining({
          field: "product_description_zh",
          term: BANNED,
          replacement: CORRECTED,
        }),
      ]),
    );
  });

  it("records nothing for clean text", async () => {
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
    expect(recordedHits()).toEqual([]);
  });

  /**
   * The key is transliterated from the INPUT name again (DEV-1546). Nothing
   * corrects the name any more, so the two names below are different names and
   * must key differently — the previous ticket's "corrected name" key would
   * have collapsed them onto one key.
   */
  it("derives the key from the input name", async () => {
    const banned = await createCuratedProduct(
      {
        brandId: BRAND_ID,
        nameZh: `高${BANNED}保溫瓶`,
        category: "home",
        productDescriptionZh: "乾淨的描述。",
      },
      clientDouble(),
    );

    inserts = [];
    const clean = await createCuratedProduct(
      {
        brandId: BRAND_ID,
        nameZh: `高${CORRECTED}保溫瓶`,
        category: "home",
        productDescriptionZh: "乾淨的描述。",
      },
      clientDouble(),
    );

    expect(banned.key).not.toBe(clean.key);
  });

  /**
   * Rejection memory hangs off the key (DEV-1469): the approval materializer
   * passes the PROPOSAL's key, and nothing may move it, or the next run's
   * proposal misses its own hidden row and re-offers a product a human already
   * declined.
   */
  it("never re-derives a caller-supplied key", async () => {
    const created = await createCuratedProduct(
      {
        brandId: BRAND_ID,
        key: "proposal-key-from-a-previous-run",
        nameZh: `高${BANNED}保溫瓶`,
        category: "home",
        productDescriptionZh: "乾淨的描述。",
      },
      clientDouble(),
    );

    expect(created.key).toBe("proposal-key-from-a-previous-run");
  });

  /** The whole reason the write path stopped mutating. */
  it.each(["台南市保安路", "質量輕的材料", "人潮密集成長"])(
    "never rewrites the boundary false positive %s",
    async (text) => {
      await createCuratedProduct(
        {
          brandId: BRAND_ID,
          nameZh: text,
          category: "home",
          productDescriptionZh: text,
        },
        clientDouble(),
      );

      const row = inserts[0] as Record<string, string>;
      expect(row.name_zh).toBe(text);
      expect(row.product_description_zh).toBe(text);
    },
  );
});

describe("updateCuratedProduct vocabulary report", () => {
  it("detects without mutating, exactly as create does", async () => {
    const nameZh = `高${BANNED}保溫瓶`;
    const productDescriptionZh = `做工的${BANNED}很穩定。`;

    await updateCuratedProduct(
      PRODUCT_ID,
      { nameZh, productDescriptionZh },
      clientDouble(),
    );

    expect(updates).toHaveLength(1);
    const payload = updates[0] as Record<string, string>;
    expect(payload.name_zh).toBe(nameZh);
    expect(payload.product_description_zh).toBe(productDescriptionZh);

    expect(recordedHits()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "name_zh",
          term: BANNED,
          replacement: CORRECTED,
        }),
        expect.objectContaining({
          field: "product_description_zh",
          term: BANNED,
          replacement: CORRECTED,
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
