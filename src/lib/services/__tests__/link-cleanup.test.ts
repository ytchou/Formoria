import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The dead-link auto-cleanup path. The strict rule — 404, 410, and classified
 * DNS only — is the reason this service exists, so the candidate query is
 * exercised through a database double that actually applies the filters it is
 * handed, rather than asserted on the filter arguments. A double that ignored
 * `.or()` would pass while production auto-nulled a brand whose shop merely
 * timed out.
 *
 * No module-level Supabase mock: `scripts/check-test-boundaries.mjs` forbids it
 * and the service takes injectable `client` / `writeBrand` seams instead.
 */
import {
  AUTO_NULL_STATUS_CODES,
  cleanupDeadLinks,
  type BrandWriter,
  type LinkCleanupDatabaseClient,
} from "../link-cleanup";

const BRAND_A = "3f6a1d90-4c2b-4d18-9a75-1b0e8c7d4a21";
const BRAND_B = "8c21e7b4-5a3f-4e60-b19d-2f7a6c0d8e53";
const NOW = new Date("2026-08-11T04:05:06.000Z");

/**
 * Confirmation double: every URL still answers 404, so the live re-check agrees
 * with the stored verdict and the tests below stay about the cleanup logic.
 *
 * The re-check is not incidental — `cleanupDeadLinks` refuses to null a link
 * whose stored verdict it cannot reproduce right now. A live sample found seven
 * of nine candidates answering `HEAD 404` and `GET 200`, so an unstubbed test
 * would (correctly) skip everything and assert nothing.
 */
const deadFetch = (() =>
  Promise.resolve(
    new Response(null, { status: 404 }),
  )) as unknown as typeof fetch;

const aliveFetch = (() =>
  Promise.resolve(
    new Response(null, { status: 200 }),
  )) as unknown as typeof fetch;

type StoredRow = {
  id: string;
  brand_id: string;
  field: string;
  url: string;
  last_status_code: number | null;
  failure_reason:
    "timeout" | "dns" | "tls" | "connection_reset" | "http" | null;
  cleanup_required: boolean;
  auto_nulled_at: string | null;
  brand_name: string | null;
};

function row(overrides: Partial<StoredRow> & { id: string }): StoredRow {
  return {
    brand_id: BRAND_A,
    field: "purchase_shopee",
    url: "https://shopee.tw/mu-guang/ceramic-cup",
    last_status_code: 404,
    failure_reason: "http",
    cleanup_required: true,
    auto_nulled_at: null,
    brand_name: "沐光陶器",
    ...overrides,
  };
}

type Db = {
  client: LinkCleanupDatabaseClient;
  table: StoredRow[];
  updates: Array<{ id: string; auto_nulled_at: string }>;
};

/**
 * In-memory `link_check_results` that honours `.eq` / `.is` / `.or` for real,
 * so the assertions below are about the query the service builds.
 */
function createDb(table: StoredRow[], updateError?: { message: string }): Db {
  const updates: Array<{ id: string; auto_nulled_at: string }> = [];

  const client = {
    from(tableName: string) {
      if (tableName !== "link_check_results") {
        throw new Error(`unexpected table: ${tableName}`);
      }
      return {
        select() {
          const filters: Array<(candidate: StoredRow) => boolean> = [];
          const builder = {
            eq(column: string, value: unknown) {
              filters.push(
                (candidate) => candidate[column as keyof StoredRow] === value,
              );
              return builder;
            },
            is(column: string, value: unknown) {
              filters.push(
                (candidate) => candidate[column as keyof StoredRow] === value,
              );
              return builder;
            },
            resolve() {
              const matched = table.filter((candidate) =>
                filters.every((predicate) => predicate(candidate)),
              );
              return {
                data: matched.map((candidate) => ({
                  id: candidate.id,
                  brand_id: candidate.brand_id,
                  field: candidate.field,
                  url: candidate.url,
                  last_status_code: candidate.last_status_code,
                  failure_reason: candidate.failure_reason,
                  brands: { name: candidate.brand_name },
                })),
                error: null,
              };
            },
            async in(column: string, values: unknown[]) {
              filters.push((candidate) =>
                values.includes(candidate[column as keyof StoredRow]),
              );
              return builder.resolve();
            },
            or(filter: string) {
              expect(filter).toBe(
                "and(last_status_code.in.(404,410),failure_reason.is.null),and(last_status_code.in.(404,410),failure_reason.eq.http),and(last_status_code.is.null,failure_reason.eq.dns)",
              );
              filters.push(
                (candidate) =>
                  ([404, 410].includes(candidate.last_status_code ?? -1) &&
                    (candidate.failure_reason === null ||
                      candidate.failure_reason === "http")) ||
                  (candidate.last_status_code === null &&
                    candidate.failure_reason === "dns"),
              );
              return builder.resolve();
            },
          };
          return builder;
        },
        update(values: { auto_nulled_at: string }) {
          return {
            async eq(_column: string, id: string) {
              if (updateError) return { data: null, error: updateError };
              updates.push({ id, auto_nulled_at: values.auto_nulled_at });
              const stored = table.find((candidate) => candidate.id === id);
              if (stored) stored.auto_nulled_at = values.auto_nulled_at;
              return { data: null, error: null };
            },
          };
        },
      };
    },
  } as unknown as LinkCleanupDatabaseClient;

  return { client, table, updates };
}

/** `updateBrand` stand-in that writes nothing and reports no skips. */
function writerAllowingEverything(): BrandWriter {
  return vi.fn(async () => ({ skipped: [] }));
}

describe("cleanupDeadLinks", () => {
  let writeBrand: BrandWriter;

  beforeEach(() => {
    writeBrand = writerAllowingEverything();
  });

  it("exposes 404 and 410 as the only auto-nullable status codes", () => {
    expect([...AUTO_NULL_STATUS_CODES].sort()).toEqual([404, 410]);
  });

  it("never auto-nulls a transient failure", async () => {
    const db = createDb([
      row({ id: "r-500", last_status_code: 500 }),
      row({ id: "r-405", last_status_code: 405, field: "purchase_pinkoi" }),
      row({ id: "r-402", last_status_code: 402, field: "purchase_website" }),
      row({ id: "r-null", last_status_code: null, field: "social_instagram" }),
    ]);

    const result = await cleanupDeadLinks({
      client: db.client,
      fetchFn: deadFetch,
      writeBrand,
      now: () => NOW,
    });

    expect(result).toEqual({ applied: [], skipped: [], scanned: 0 });
    expect(writeBrand).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
  });

  it("auto-nulls only a sustained DNS failure after a DNS re-check", async () => {
    const db = createDb([
      row({ id: "r-dns", last_status_code: null, failure_reason: "dns" }),
      row({
        id: "r-timeout",
        last_status_code: null,
        failure_reason: "timeout",
        field: "purchase_website",
      }),
      row({
        id: "r-tls",
        last_status_code: null,
        failure_reason: "tls",
        field: "purchase_pinkoi",
      }),
      row({
        id: "r-reset",
        last_status_code: null,
        failure_reason: "connection_reset",
        field: "social_instagram",
      }),
      row({
        id: "r-transient-dns",
        last_status_code: null,
        failure_reason: null,
        field: "social_facebook",
      }),
      row({
        id: "r-404-tls",
        last_status_code: 404,
        failure_reason: "tls",
        field: "purchase_myship",
      }),
      row({
        id: "r-410-dns",
        last_status_code: 410,
        failure_reason: "dns",
        field: "purchase_myship",
      }),
      row({
        id: "r-500-dns",
        last_status_code: 500,
        failure_reason: "dns",
        field: "purchase_myship",
      }),
      row({
        id: "r-200-dns",
        last_status_code: 200,
        failure_reason: "dns",
        field: "purchase_myship",
      }),
    ]);
    const dnsFetch = (() =>
      Promise.reject(
        new TypeError("fetch failed", {
          cause: { code: "ENOTFOUND" },
        }),
      )) as unknown as typeof fetch;

    const result = await cleanupDeadLinks({
      client: db.client,
      fetchFn: dnsFetch,
      writeBrand,
      now: () => NOW,
    });

    expect(result.applied).toEqual([
      {
        brandId: BRAND_A,
        brandName: "沐光陶器",
        field: "purchase_shopee",
        url: "https://shopee.tw/mu-guang/ceramic-cup",
        statusCode: null,
      },
    ]);
    expect(result.scanned).toBe(1);
  });

  it("ignores a row that was already auto-nulled", async () => {
    const db = createDb([
      row({ id: "r-done", auto_nulled_at: "2026-08-01T00:00:00.000Z" }),
    ]);

    const result = await cleanupDeadLinks({
      client: db.client,
      fetchFn: deadFetch,
      writeBrand,
      now: () => NOW,
    });

    expect(result.scanned).toBe(0);
    expect(writeBrand).not.toHaveBeenCalled();
  });

  it("ignores a row the checker has not flagged for cleanup", async () => {
    const db = createDb([row({ id: "r-unflagged", cleanup_required: false })]);

    const result = await cleanupDeadLinks({
      client: db.client,
      fetchFn: deadFetch,
      writeBrand,
      now: () => NOW,
    });

    expect(result.scanned).toBe(0);
  });

  it("nulls a dead link and stamps auto_nulled_at", async () => {
    const db = createDb([
      row({ id: "r-410", last_status_code: 410, field: "purchase_pinkoi" }),
    ]);

    const result = await cleanupDeadLinks({
      client: db.client,
      fetchFn: deadFetch,
      writeBrand,
      now: () => NOW,
    });

    expect(writeBrand).toHaveBeenCalledWith(
      BRAND_A,
      { purchasePinkoi: null },
      { source: "enriched" },
    );
    expect(result.applied).toEqual([
      {
        brandId: BRAND_A,
        brandName: "沐光陶器",
        field: "purchase_pinkoi",
        url: "https://shopee.tw/mu-guang/ceramic-cup",
        statusCode: 410,
      },
    ]);
    expect(result.skipped).toEqual([]);
    expect(db.updates).toEqual([
      { id: "r-410", auto_nulled_at: NOW.toISOString() },
    ]);
  });

  it("maps a social column to its camelCase brand field", async () => {
    const db = createDb([
      row({
        id: "r-ig",
        field: "social_instagram",
        url: "https://www.instagram.com/mu.guang.ceramics",
      }),
    ]);

    await cleanupDeadLinks({
      client: db.client,
      fetchFn: deadFetch,
      writeBrand,
      now: () => NOW,
    });

    expect(writeBrand).toHaveBeenCalledWith(
      BRAND_A,
      { socialInstagram: null },
      { source: "enriched" },
    );
  });

  it("leaves an owner-protected field live and unstamped", async () => {
    const db = createDb([row({ id: "r-owner" })]);
    const protectingWriter: BrandWriter = vi.fn(async () => ({
      skipped: [{ field: "purchase_shopee", reason: "protected:owner" }],
    }));

    const result = await cleanupDeadLinks({
      client: db.client,
      fetchFn: deadFetch,
      writeBrand: protectingWriter,
      now: () => NOW,
    });

    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([
      {
        brandId: BRAND_A,
        field: "purchase_shopee",
        url: "https://shopee.tw/mu-guang/ceramic-cup",
        reason: "protected:owner",
      },
    ]);
    // The value is still on the brand, so the row must stay a candidate.
    expect(db.updates).toEqual([]);
    expect(db.table[0]?.auto_nulled_at).toBeNull();
  });

  it("applies a field the writer skipped for a different column", async () => {
    const db = createDb([row({ id: "r-other-skip" })]);
    const noisyWriter: BrandWriter = vi.fn(async () => ({
      skipped: [{ field: "description", reason: "protected:admin" }],
    }));

    const result = await cleanupDeadLinks({
      client: db.client,
      fetchFn: deadFetch,
      writeBrand: noisyWriter,
      now: () => NOW,
    });

    expect(result.applied).toHaveLength(1);
    expect(db.updates).toHaveLength(1);
  });

  it("reports an unsupported column instead of throwing", async () => {
    const db = createDb([
      row({
        id: "r-hero",
        field: "hero_image_url",
        url: "https://cdn.example.test/mu-guang.jpg",
      }),
    ]);

    const result = await cleanupDeadLinks({
      client: db.client,
      fetchFn: deadFetch,
      writeBrand,
      now: () => NOW,
    });

    expect(result.skipped).toEqual([
      {
        brandId: BRAND_A,
        field: "hero_image_url",
        url: "https://cdn.example.test/mu-guang.jpg",
        reason: "unsupported_field",
      },
    ]);
    expect(writeBrand).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
  });

  it("writes nothing on a dry run", async () => {
    const db = createDb([
      row({ id: "r-dry-1" }),
      row({
        id: "r-dry-2",
        brand_id: BRAND_B,
        field: "hero_image_url",
        brand_name: "青瓷工作室",
      }),
    ]);

    const result = await cleanupDeadLinks({
      client: db.client,
      fetchFn: deadFetch,
      writeBrand,
      now: () => NOW,
      dryRun: true,
    });

    expect(result.scanned).toBe(2);
    expect(result.applied.map((entry) => entry.field)).toEqual([
      "purchase_shopee",
    ]);
    expect(result.skipped.map((entry) => entry.reason)).toEqual([
      "unsupported_field",
    ]);
    expect(writeBrand).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
  });

  it("keeps processing after one row's write throws", async () => {
    const db = createDb([
      row({ id: "r-boom" }),
      row({
        id: "r-ok",
        brand_id: BRAND_B,
        field: "purchase_website",
        url: "https://mu-guang.tw",
        brand_name: "青瓷工作室",
      }),
    ]);
    const flakyWriter: BrandWriter = vi.fn(async (brandId: string) => {
      if (brandId === BRAND_A) throw new Error("apply_brand_patch timed out");
      return { skipped: [] };
    });

    const result = await cleanupDeadLinks({
      client: db.client,
      fetchFn: deadFetch,
      writeBrand: flakyWriter,
      now: () => NOW,
    });

    expect(result.scanned).toBe(2);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toMatch(/^write_failed:/);
    expect(result.applied).toEqual([
      {
        brandId: BRAND_B,
        brandName: "青瓷工作室",
        field: "purchase_website",
        url: "https://mu-guang.tw",
        statusCode: 404,
      },
    ]);
    expect(db.updates).toEqual([
      { id: "r-ok", auto_nulled_at: NOW.toISOString() },
    ]);
  });

  it("does not claim success when the stamp write fails", async () => {
    const db = createDb([row({ id: "r-stamp" })], {
      message: "connection reset",
    });

    const result = await cleanupDeadLinks({
      client: db.client,
      fetchFn: deadFetch,
      writeBrand,
      now: () => NOW,
    });

    expect(result.applied).toEqual([]);
    expect(result.skipped[0]?.reason).toMatch(/^stamp_failed:/);
  });

  describe("live re-check before removal", () => {
    // This is the safeguard that matters most in the service. The first real
    // dry run queued nine links for removal; a live sample found seven of them
    // answering HEAD 404 but GET 200, because `checkUrl` treated a HEAD 404 as
    // final. Applying would have destroyed seven working purchase links.
    //
    // link-health.ts now retries 404/410 with GET, but this check exists so a
    // detector bug can never again reach a destructive write — it deliberately
    // does not depend on that fix being correct.

    it("refuses to remove a link that answers on a live re-check", async () => {
      const db = createDb([row({ id: "r-alive" })]);

      const result = await cleanupDeadLinks({
        client: db.client,
        fetchFn: aliveFetch,
        writeBrand,
        now: () => NOW,
      });

      expect(result.applied).toEqual([]);
      expect(result.skipped[0]?.reason).toBe("recheck_alive:200");
      expect(writeBrand).not.toHaveBeenCalled();
      expect(db.updates).toEqual([]);
    });

    it("refuses when the re-check itself fails, rather than assuming dead", async () => {
      // Our own network failing is not evidence about the URL.
      const db = createDb([row({ id: "r-unreachable" })]);
      const throwingFetch = (() =>
        Promise.reject(new Error("ENETDOWN"))) as unknown as typeof fetch;

      const result = await cleanupDeadLinks({
        client: db.client,
        fetchFn: throwingFetch,
        writeBrand,
        now: () => NOW,
      });

      expect(result.applied).toEqual([]);
      expect(result.skipped[0]?.reason).toBe("recheck_inconclusive");
      expect(writeBrand).not.toHaveBeenCalled();
    });

    it("applies the same re-check in dry run", async () => {
      // A dry run whose purpose is to preview destruction is worthless if it
      // previews a different decision than the real run would make.
      const db = createDb([row({ id: "r-dry" })]);

      const result = await cleanupDeadLinks({
        client: db.client,
        dryRun: true,
        fetchFn: aliveFetch,
        writeBrand,
        now: () => NOW,
      });

      expect(result.applied).toEqual([]);
      expect(result.skipped[0]?.reason).toBe("recheck_alive:200");
    });
  });
});
