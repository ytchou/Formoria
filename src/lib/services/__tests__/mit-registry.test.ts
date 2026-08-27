import { describe, expect, it } from "vitest";
import {
  classifyMitRegistryHealth,
  dedupeRegistryRecords,
  parseManifestFilenames,
  parseMitCsv,
  shouldSweepStaleRecords,
} from "../mit-registry";

const COMPLETE = { expectedFileCount: 26, parsedFileCount: 26 };

describe("MIT registry archive", () => {
  it("preserves product/model variants sharing one certificate", () => {
    const csv = [
      "序號,產業別,獲證業者,統一編號,產品名稱,產品型號,產品效期,標章編號,品牌名稱,備註",
      '1,"織襪","珀興企業有限公司","24767215","戶外機能動動襪","S01A(迷彩)","20270515","01700577-00001","RAFAC","【有效】"',
      '2,"織襪","珀興企業有限公司","24767215","戶外機能動動襪","S01A(水藍)","20270515","01700577-00001","RAFAC","【有效】"',
    ].join("\n");

    const records = parseMitCsv(csv);

    expect(records).toHaveLength(2);
    expect(new Set(records.map((record) => record.record_key)).size).toBe(2);
    expect(records.map((record) => record.cert_number)).toEqual([
      "01700577-00001",
      "01700577-00001",
    ]);
  });

  it("reads every data file named by the manifest", () => {
    const manifest = [
      "﻿name,schema,description",
      "011.csv,schema-01.csv,成衣",
      "017.csv,schema-07.csv,織襪",
      "301.csv,schema-26.csv,一般類",
      "schema-01.csv,,columns",
      "manifest.csv,,index",
    ].join("\n");

    expect(parseManifestFilenames(manifest)).toEqual([
      "011.csv",
      "017.csv",
      "301.csv",
    ]);
  });

  it("deduplicates repeated rows without collapsing model variants", () => {
    const record = {
      record_key: "same-row",
      cert_number: "01700577-00001",
      company_name: "珀興企業有限公司",
      brand_name: "RAFAC",
      product_name: "戶外機能動動襪",
      product_model: "S01A(迷彩)",
      industry_type: "織襪",
      valid_until: "20270515",
      normalized_brand: "rafac",
      normalized_product: "戶外機能動動襪",
      normalized_model: "s01a迷彩",
    };
    const variant = { ...record, record_key: "distinct-model", product_model: "S01A(水藍)" };

    expect(dedupeRegistryRecords([record, record, variant])).toEqual([
      record,
      variant,
    ]);
  });

  it("withholds the stale-row sweep for incomplete or truncated archives", () => {
    expect(
      shouldSweepStaleRecords({
        parsedCount: 245_135,
        existingCount: 244_900,
        ...COMPLETE,
      }),
    ).toBe(true);
    expect(
      shouldSweepStaleRecords({
        parsedCount: 29_452,
        existingCount: 29_450,
        expectedFileCount: 26,
        parsedFileCount: 1,
      }),
    ).toBe(false);
    expect(
      shouldSweepStaleRecords({
        parsedCount: 29_452,
        existingCount: 245_135,
        ...COMPLETE,
      }),
    ).toBe(false);
  });

  it("reports mirror health from the newest successful batch", () => {
    expect(
      classifyMitRegistryHealth(
        [{ synced_at: "2026-08-25T00:00:00.000Z" }],
        new Date("2026-08-26T00:00:00.000Z"),
      ).status,
    ).toBe("healthy");
    expect(
      classifyMitRegistryHealth(
        [{ synced_at: "2026-08-17T23:59:59.000Z" }],
        new Date("2026-08-26T00:00:00.000Z"),
      ).status,
    ).toBe("degraded");
  });
});
