import { describe, expect, it } from "vitest";
import {
  MIN_SWEEP_COVERAGE_RATIO,
  dedupeRecordsByCert,
  parseManifestFilenames,
  parseMitCsv,
  shouldSweepStaleRecords,
} from "../mit-registry";

/**
 * The archive reader is tested through its pure parts rather than by driving
 * `syncMitRegistry`, which needs the live upstream ZIP and a Supabase client.
 * Those parts are where every decision is made: which files to open, which rows
 * survive to the upsert, and whether the delete is allowed to run.
 */

/** The whole archive: 26 data files, every one of them read. */
const COMPLETE = { expectedFileCount: 26, parsedFileCount: 26 };

describe("shouldSweepStaleRecords", () => {
  it("sweeps on an empty table so the first populating sync is unblocked", () => {
    expect(
      shouldSweepStaleRecords({ parsedCount: 245_135, existingCount: 0, ...COMPLETE }),
    ).toBe(true);
  });

  it("sweeps a full weekly republish", () => {
    expect(
      shouldSweepStaleRecords({
        parsedCount: 245_135,
        existingCount: 244_900,
        ...COMPLETE,
      }),
    ).toBe(true);
  });

  it("sweeps a plausible net shrink", () => {
    expect(
      shouldSweepStaleRecords({
        parsedCount: 240_000,
        existingCount: 245_135,
        ...COMPLETE,
      }),
    ).toBe(true);
  });

  it("refuses to sweep a truncated payload", () => {
    expect(
      shouldSweepStaleRecords({
        parsedCount: 29_452,
        existingCount: 245_135,
        ...COMPLETE,
      }),
    ).toBe(false);
  });

  it("refuses to sweep an empty payload, table populated or not", () => {
    expect(
      shouldSweepStaleRecords({ parsedCount: 0, existingCount: 245_135, ...COMPLETE }),
    ).toBe(false);
    // Deleting nothing from nothing is a no-op either way, so the stricter rule
    // costs nothing and holds "a payload with no rows never authorizes a
    // delete" without an exception to reason about.
    expect(shouldSweepStaleRecords({ parsedCount: 0, existingCount: 0, ...COMPLETE })).toBe(
      false,
    );
  });

  it("refuses to sweep when the archive was only partly read (DEV-1475)", () => {
    // The regression itself: one file of 26, against a table holding exactly
    // that one file's rows. Coverage reads as 100% and the ratio waves it
    // through — which is how a 1/26 mirror stayed green for weeks.
    expect(
      shouldSweepStaleRecords({
        parsedCount: 29_452,
        existingCount: 29_450,
        expectedFileCount: 26,
        parsedFileCount: 1,
      }),
    ).toBe(false);
  });

  it("refuses to sweep when the manifest indexed nothing", () => {
    // A changed upstream layout, not an empty dataset.
    expect(
      shouldSweepStaleRecords({
        parsedCount: 0,
        existingCount: 245_135,
        expectedFileCount: 0,
        parsedFileCount: 0,
      }),
    ).toBe(false);
  });

  it("treats the coverage ratio as the inclusive floor", () => {
    const existingCount = 1_000;
    const floor = existingCount * MIN_SWEEP_COVERAGE_RATIO;
    expect(
      shouldSweepStaleRecords({ parsedCount: floor, existingCount, ...COMPLETE }),
    ).toBe(true);
    expect(
      shouldSweepStaleRecords({ parsedCount: floor - 1, existingCount, ...COMPLETE }),
    ).toBe(false);
  });
});

describe("parseManifestFilenames", () => {
  // Byte-for-byte shape of the upstream manifest, BOM included.
  const manifest = [
    "﻿name,schema,description",
    "011.csv,schema-01.csv,成衣產業獲證產品清單",
    "017.csv,schema-07.csv,織襪產業獲證產品清單",
    "301.csv,schema-26.csv,一般類獲證產品清單",
  ].join("\n");

  it("returns every data file the manifest indexes", () => {
    expect(parseManifestFilenames(manifest)).toEqual([
      "011.csv",
      "017.csv",
      "301.csv",
    ]);
  });

  it("strips the BOM so the name column resolves", () => {
    // Without the strip the first header parses as "﻿name", `indexOf`
    // misses, and the sync silently indexes nothing.
    expect(parseManifestFilenames(manifest.replace("﻿", ""))).toEqual(
      parseManifestFilenames(manifest),
    );
  });

  it("skips the schema descriptions and the manifest itself", () => {
    const withNoise = [
      "﻿name,schema,description",
      "011.csv,schema-01.csv,成衣產業獲證產品清單",
      "manifest.csv,,index",
      "schema-01.csv,,columns",
    ].join("\n");
    expect(parseManifestFilenames(withNoise)).toEqual(["011.csv"]);
  });

  it("indexes nothing when the manifest is empty or unrecognisable", () => {
    expect(parseManifestFilenames("")).toEqual([]);
    expect(parseManifestFilenames("﻿name,schema,description")).toEqual([]);
    expect(parseManifestFilenames("file,schema\n011.csv,schema-01.csv")).toEqual([]);
  });
});

describe("parseMitCsv", () => {
  // rafac's real row from 017.csv, header and all — the certificate DEV-1475
  // opened with, which the 011-only sync could never reach.
  const csv = [
    "序號,產業別,獲證業者,統一編號,產品名稱,產品型號,產品效期,標章編號,品牌名稱,備註",
    '27098,"織襪","珀興企業有限公司","24767215","戶外機能動動襪","S01A(迷彩)","20270515","01700577-00001","RAFAC","【有效】"',
  ].join("\n");

  it("reads a government row into a registry record", () => {
    expect(parseMitCsv(csv)).toEqual([
      {
        cert_number: "01700577-00001",
        company_name: "珀興企業有限公司",
        brand_name: "RAFAC",
        product_name: "戶外機能動動襪",
        product_model: "S01A(迷彩)",
        industry_type: "織襪",
        valid_until: "20270515",
      },
    ]);
  });

  it("drops a row carrying no certificate number", () => {
    const headerOnlyCert = csv.replace('"01700577-00001"', '""');
    expect(parseMitCsv(headerOnlyCert)).toEqual([]);
  });

  it("returns nothing for an empty or header-only file", () => {
    expect(parseMitCsv("")).toEqual([]);
    expect(parseMitCsv(csv.split("\n")[0]!)).toEqual([]);
  });
});

describe("dedupeRecordsByCert", () => {
  const record = (cert: string, validUntil: string | null, productName: string) => ({
    cert_number: cert,
    company_name: null,
    brand_name: null,
    product_name: productName,
    product_model: null,
    industry_type: null,
    valid_until: validUntil,
  });

  it("collapses a certificate's product variants to one row", () => {
    // 826 certificates arrive more than once; two in one batch is an
    // `ON CONFLICT DO UPDATE` that touches the same row twice, which Postgres
    // rejects and which fails the whole batch.
    const deduped = dedupeRecordsByCert([
      record("01100039-00272", "20130930", "吸濕排汗衫二扣(男款)-水藍"),
      record("01100039-00272", "20140831", "小丑魚吸溼排汗polo衫男-灰色O"),
      record("01700577-00001", "20270515", "戶外機能動動襪"),
    ]);
    expect(deduped).toHaveLength(2);
    expect(new Set(deduped.map((r) => r.cert_number)).size).toBe(2);
  });

  it("keeps the latest expiry, not the last row seen", () => {
    // A certificate is live until the last of its products expires, and file
    // order is arbitrary — so last-wins would retire live certificates.
    const [kept] = dedupeRecordsByCert([
      record("01100039-00272", "20140831", "later"),
      record("01100039-00272", "20130930", "earlier"),
    ]);
    expect(kept!.valid_until).toBe("20140831");
    expect(kept!.product_name).toBe("later");
  });

  it("prefers any stated expiry over none", () => {
    const [kept] = dedupeRecordsByCert([
      record("01100039-00272", null, "undated"),
      record("01100039-00272", "20140831", "dated"),
    ]);
    expect(kept!.valid_until).toBe("20140831");
  });
});
