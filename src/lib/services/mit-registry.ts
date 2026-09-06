import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { auditedCall } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/service";
import {
  classifyRegistryRecord,
  MIT_REGISTRY_SYNC_MAX_AGE_HOURS,
  normalizeRegistryValue,
  selectExactRegistryMatch,
  type RegistryOriginAssessment,
  type RegistryOriginRecord,
} from "@/lib/services/curated-products/origin-qualification";

export type MitRegistryRecord = {
  record_key: string;
  cert_number: string;
  company_name: string | null;
  brand_name: string | null;
  product_name: string | null;
  product_model: string | null;
  industry_type: string | null;
  valid_until: string | null;
  normalized_brand: string;
  normalized_product: string;
  normalized_model: string;
};

export type MitRegistryHealth = {
  status: "healthy" | "degraded" | "down";
  message: string;
};

type MitRegistrySyncRow = { synced_at: string | null };

const MIT_ZIP_URL = "https://keid.nat.gov.tw/mittw/Files/Download/productlist.zip";
const MANIFEST_FILENAME = "manifest.csv";
const BATCH_SIZE = 1_000;
const MIN_SWEEP_COVERAGE_RATIO = 0.8;

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (character === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }
    current += character;
  }

  fields.push(current);
  return fields;
}

function registryRecordKey(record: Omit<MitRegistryRecord, "record_key">): string {
  return createHash("sha256")
    .update(
      [
        record.cert_number,
        record.company_name ?? "",
        record.brand_name ?? "",
        record.product_name ?? "",
        record.product_model ?? "",
        record.industry_type ?? "",
      ].join("\u001f"),
    )
    .digest("hex");
}

export function parseMitCsv(csvContent: string): MitRegistryRecord[] {
  const lines = csvContent
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .filter((line) => line.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0] ?? "").map((header) => header.trim());
  const records: MitRegistryRecord[] = [];

  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line).map((cell) => cell.trim());
    const row = Object.fromEntries(
      headers.map((header, index) => [header, cells[index] ?? ""]),
    );
    const certNumber = row["標章編號"] ?? "";
    if (!certNumber) continue;

    const base: Omit<MitRegistryRecord, "record_key"> = {
      cert_number: certNumber,
      company_name: row["獲證業者"] || null,
      brand_name: row["品牌名稱"] || null,
      product_name: row["產品名稱"] || null,
      product_model: row["產品型號"] || null,
      industry_type: row["產業別"] || null,
      valid_until: row["產品效期"] || null,
      normalized_brand: normalizeRegistryValue(row["品牌名稱"]),
      normalized_product: normalizeRegistryValue(row["產品名稱"]),
      normalized_model: normalizeRegistryValue(row["產品型號"]),
    };
    records.push({ record_key: registryRecordKey(base), ...base });
  }

  return records;
}

export function parseManifestFilenames(manifestCsv: string): string[] {
  const lines = manifestCsv
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .filter((line) => line.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0] ?? "").map((header) => header.trim());
  const nameIndex = headers.indexOf("name");
  if (nameIndex === -1) return [];

  return lines
    .slice(1)
    .map((line) => parseCsvLine(line)[nameIndex]?.trim() ?? "")
    .filter(
      (name) =>
        name !== "" &&
        name !== MANIFEST_FILENAME &&
        !name.startsWith("schema-"),
    );
}

/** Duplicate rows can appear in more than one manifest data file. */
export function dedupeRegistryRecords(
  records: readonly MitRegistryRecord[],
): MitRegistryRecord[] {
  return [...new Map(records.map((record) => [record.record_key, record])).values()];
}

export function shouldSweepStaleRecords(input: {
  parsedCount: number;
  existingCount: number;
  expectedFileCount: number;
  parsedFileCount: number;
}): boolean {
  if (input.expectedFileCount === 0) return false;
  if (input.parsedFileCount < input.expectedFileCount) return false;
  if (input.parsedCount === 0) return false;
  if (input.existingCount === 0) return true;
  return input.parsedCount >= input.existingCount * MIN_SWEEP_COVERAGE_RATIO;
}

export function classifyMitRegistryHealth(
  rows: readonly MitRegistrySyncRow[],
  now: Date = new Date(),
): MitRegistryHealth {
  const latest = rows.at(0);
  if (!latest) return { status: "down", message: "MIT registry mirror is empty" };

  const syncedAt = latest.synced_at ? Date.parse(latest.synced_at) : Number.NaN;
  if (!Number.isFinite(syncedAt)) {
    return { status: "degraded", message: "MIT registry sync timestamp is invalid" };
  }
  const ageHours = (now.getTime() - syncedAt) / 3_600_000;
  if (ageHours < 0 || ageHours > MIT_REGISTRY_SYNC_MAX_AGE_HOURS) {
    return { status: "degraded", message: "MIT registry mirror is stale" };
  }
  return { status: "healthy", message: "MIT registry mirror is fresh" };
}

export async function checkMitRegistryHealth(): Promise<MitRegistryHealth> {
  try {
    const { data, error } = await createServiceClient()
      .from("mit_registry")
      .select("synced_at")
      .order("synced_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    return classifyMitRegistryHealth((data ?? []) as MitRegistrySyncRow[]);
  } catch {
    return { status: "down", message: "MIT registry query failed" };
  }
}

export type ExactRegistryLookupInput = {
  candidateId: string;
  brand: string;
  product: string;
  model?: string | null;
};

export type ExactRegistryLookupResult = {
  record: RegistryOriginRecord | null;
  assessment: RegistryOriginAssessment;
};

type MitRegistryQueryRow = {
  id: number;
  cert_number: string;
  normalized_brand: string;
  normalized_product: string;
  normalized_model: string;
  valid_until: string | null;
  synced_at: string | null;
};

function toOriginRecord(row: MitRegistryQueryRow): RegistryOriginRecord {
  return {
    id: row.id,
    certNumber: row.cert_number,
    normalizedBrand: row.normalized_brand,
    normalizedProduct: row.normalized_product,
    normalizedModel: row.normalized_model,
    validUntil: row.valid_until,
    syncedAt: row.synced_at,
  };
}

export async function lookupExactRegistryProducts(
  inputs: readonly ExactRegistryLookupInput[],
  now: Date = new Date(),
): Promise<Map<string, ExactRegistryLookupResult>> {
  const normalized = inputs
    .map((input) => ({
      ...input,
      normalizedBrand: normalizeRegistryValue(input.brand),
      normalizedProduct: normalizeRegistryValue(input.product),
    }))
    .filter((input) => input.normalizedBrand && input.normalizedProduct);
  if (normalized.length === 0) return new Map();

  const brands = [...new Set(normalized.map((input) => input.normalizedBrand))];
  const products = [...new Set(normalized.map((input) => input.normalizedProduct))];
  const rows = await auditedCall(
    { provider: "mit-registry", operation: "lookup_exact_products", kind: "external" },
    async () => {
      const { data, error } = await createServiceClient()
        .from("mit_registry")
        .select(
          "id, cert_number, normalized_brand, normalized_product, normalized_model, valid_until, synced_at",
        )
        .in("normalized_brand", brands)
        .in("normalized_product", products);
      if (error) throw error;
      return (data ?? []) as MitRegistryQueryRow[];
    },
    {
      classify: (records) => (records.length > 0 ? "succeeded" : "empty"),
      summary: { candidateCount: normalized.length },
    },
  );

  const originRows = rows.map(toOriginRecord);
  const matches = new Map<string, ExactRegistryLookupResult>();
  for (const input of normalized) {
    const exactRows = originRows.filter(
      (record) =>
        record.normalizedBrand === input.normalizedBrand &&
        record.normalizedProduct === input.normalizedProduct &&
        record.normalizedModel === normalizeRegistryValue(input.model),
    );
    const active = selectExactRegistryMatch(exactRows, input, now);
    if (active) {
      matches.set(input.candidateId, {
        record: active,
        assessment: { matched: true, recordId: active.id, reason: "matched" },
      });
      continue;
    }
    const inactive = exactRows[0];
    matches.set(input.candidateId, {
      record: null,
      assessment: inactive
        ? {
            matched: false,
            recordId: inactive.id,
            reason: classifyRegistryRecord(inactive, now),
          }
        : { matched: false, recordId: null, reason: "no_exact_match" },
    });
  }
  return matches;
}

export async function syncMitRegistry(): Promise<{
  recordCount: number;
  durationMs: number;
  sweptStale: boolean;
}> {
  const startedAt = Date.now();
  const syncSummary: Record<string, unknown> = {};
  const archive = await auditedCall(
    { provider: "mit-registry", operation: "sync_registry", kind: "external" },
    async () => {
      const response = await fetch(MIT_ZIP_URL);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch MIT registry ZIP: ${response.status} ${response.statusText}`,
        );
      }
      const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
      const manifest = zip.getEntry(MANIFEST_FILENAME);
      if (!manifest) throw new Error(`"${MANIFEST_FILENAME}" not found in ZIP archive`);

      const filenames = parseManifestFilenames(manifest.getData().toString("utf-8"));
      if (filenames.length === 0) {
        throw new Error(`"${MANIFEST_FILENAME}" listed no data files`);
      }

      const records: MitRegistryRecord[] = [];
      const skippedFiles: string[] = [];
      let parsedFileCount = 0;
      for (const filename of filenames) {
        const entry = zip.getEntry(filename);
        const parsed = entry ? parseMitCsv(entry.getData().toString("utf-8")) : [];
        if (parsed.length === 0) {
          skippedFiles.push(filename);
          continue;
        }
        parsedFileCount += 1;
        records.push(...parsed);
      }

      const uniqueRecords = dedupeRegistryRecords(records);
      Object.assign(syncSummary, {
        recordCount: uniqueRecords.length,
        duplicateRecordCount: records.length - uniqueRecords.length,
        expectedFileCount: filenames.length,
        parsedFileCount,
        skippedFiles,
      });
      if (parsedFileCount !== filenames.length) {
        throw new Error(
          `MIT registry archive incomplete: parsed ${parsedFileCount} of ${filenames.length} manifest files`,
        );
      }
      return {
        records: uniqueRecords,
        expectedFileCount: filenames.length,
        parsedFileCount,
      };
    },
    {
      classify: (result) => (result.records.length > 0 ? "succeeded" : "empty"),
      summary: { result: syncSummary },
    },
  );

  const supabase = createServiceClient();
  const syncedAt = new Date(startedAt).toISOString();
  const { count: existingCount, error: countError } = await supabase
    .from("mit_registry")
    .select("record_key", { count: "exact", head: true });
  if (countError) throw countError;

  for (let index = 0; index < archive.records.length; index += BATCH_SIZE) {
    const batch = archive.records.slice(index, index + BATCH_SIZE).map((record) => ({
      ...record,
      synced_at: syncedAt,
    }));
    const { error } = await supabase
      .from("mit_registry")
      .upsert(batch, { onConflict: "record_key" });
    if (error) throw error;
  }

  const sweptStale = shouldSweepStaleRecords({
    parsedCount: archive.records.length,
    existingCount: existingCount ?? 0,
    expectedFileCount: archive.expectedFileCount,
    parsedFileCount: archive.parsedFileCount,
  });
  if (sweptStale) {
    const { error } = await supabase
      .from("mit_registry")
      .delete()
      .lt("synced_at", syncedAt);
    if (error) throw error;
  }

  return {
    recordCount: archive.records.length,
    durationMs: Date.now() - startedAt,
    sweptStale,
  };
}

