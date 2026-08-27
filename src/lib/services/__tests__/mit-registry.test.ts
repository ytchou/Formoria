import { describe, expect, it } from "vitest";
import {
  classifyMitRegistryHealth,
  dedupeRegistryRecords,
  parseManifestFilenames,
  parseMitCsv,
  shouldSweepStaleRecords,
} from "../mit-registry";

const COMPLETE = { expectedFileCount: 3, parsedFileCount: 3 };

describe("MIT registry archive", () => {
  it("preserves product/model variants sharing one certificate", () => {
    const certificate = "certificate-a";
    const csv = [
      "序號,產業別,獲證業者,統一編號,產品名稱,產品型號,產品效期,標章編號,品牌名稱,備註",
      `1,"Example industry","Example manufacturer","company-a","Example product","Model A","20991231","${certificate}","Example brand","Active"`,
      `2,"Example industry","Example manufacturer","company-a","Example product","Model B","20991231","${certificate}","Example brand","Active"`,
    ].join("\n");

    const records = parseMitCsv(csv);

    expect(records).toHaveLength(2);
    expect(new Set(records.map((record) => record.record_key)).size).toBe(2);
    expect(records.every((record) => record.cert_number === certificate)).toBe(true);
  });

  it("reads every data file named by the manifest", () => {
    const dataFiles = ["category-a.csv", "category-b.csv"];
    const manifest = [
      "﻿name,schema,description",
      `${dataFiles[0]},schema-a.csv,Category A`,
      `${dataFiles[1]},schema-b.csv,Category B`,
      "schema-a.csv,,columns",
      "manifest.csv,,index",
    ].join("\n");

    const filenames = parseManifestFilenames(manifest);

    expect(filenames).toHaveLength(dataFiles.length);
    expect(filenames).toEqual(expect.arrayContaining(dataFiles));
  });

  it("deduplicates repeated rows without collapsing model variants", () => {
    const record = {
      record_key: "record-a",
      cert_number: "certificate-a",
      company_name: "Example manufacturer",
      brand_name: "Example brand",
      product_name: "Example product",
      product_model: "Model A",
      industry_type: "Example industry",
      valid_until: "20991231",
      normalized_brand: "examplebrand",
      normalized_product: "exampleproduct",
      normalized_model: "modela",
    };
    const variant = {
      ...record,
      record_key: "record-b",
      product_model: "Model B",
      normalized_model: "modelb",
    };

    const records = dedupeRegistryRecords([record, record, variant]);

    expect(records).toHaveLength(2);
    expect(records).toContain(record);
    expect(records).toContain(variant);
  });

  it("withholds the stale-row sweep for incomplete or truncated archives", () => {
    expect(
      shouldSweepStaleRecords({
        parsedCount: 100,
        existingCount: 100,
        ...COMPLETE,
      }),
    ).toBe(true);
    expect(
      shouldSweepStaleRecords({
        parsedCount: 100,
        existingCount: 100,
        expectedFileCount: 3,
        parsedFileCount: 1,
      }),
    ).toBe(false);
    expect(
      shouldSweepStaleRecords({
        parsedCount: 10,
        existingCount: 100,
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
