import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { requestPublicBrandRevalidation } from "@/lib/cache/revalidate-client";
import { resolveProfileModel } from "@/lib/constants/llm-models";
import { mapWithConcurrency } from "@/lib/services/_shared/concurrency";
import {
  createProfiledOpenAIClient,
  profileChatParams,
} from "@/lib/services/llm-audit";
import { loadVisionDataUri } from "@/lib/services/vision-image";
import { createServiceClient } from "@/lib/supabase/service";
import { artifactPath, esc } from "./shared/artifact";
import { assertRevalidationConfigured } from "./curated-products/shared";

export const MANIFEST_VERSION = 1;
export const CAPTION_MIN_CHARACTERS = 30;
export const CAPTION_MAX_CHARACTERS = 80;

const MODEL = "gpt-5.6-luna";
const IMAGE_DETAIL = "low" as const;
const IMAGE_BATCH_SIZE = 10;
const IMAGE_LOAD_CONCURRENCY = 4;
const APPLY_CONCURRENCY = 8;
const REVIEW_MANAGED_SAMPLE_SIZE = 50;
const PAGE_SIZE = 1_000;

export const CAPTION_PROMPT = `你是台灣網站的無障礙圖片文字編輯。請只根據每張圖片中直接可見的內容，撰寫繁體中文（台灣）替代文字。

規則：
- 每則 30 到 80 個字元，使用完整、自然、具體的句子。
- 描述主要物件、材質、顏色、構圖、動作與場景中清楚可見的細節。
- 只有品牌名稱或標誌確實印在圖片中時，才能提及品牌；不可根據批次或背景資訊猜測。
- 不可杜撰用途、香氣、口感、品質、產地、人物身分或圖片外的資訊。
- 避免「品牌商品照」、「商品圖片」、「產品照片」等沒有描述內容的套語。
- 不要加上編號、引號、前綴、說明或 Markdown。`;

export type SupabaseEnvironment = {
  projectRef: string;
  host: string;
};

export type BackfillImage = {
  id: string;
  brandId: string;
  brandSlug: string;
  brandName: string;
  source: string;
  storagePath: string;
};

export type ManifestHeader = {
  kind: "header";
  manifestVersion: number;
  generatedAt: string;
  environment: SupabaseEnvironment;
  provenance: {
    model: string;
    profile: "classifyImages";
    imageDetail: "low";
    reasoningEffort: "none";
    prompt: string;
    promptSha256: string;
  };
  selection: {
    brandStatus: "approved";
    imageStatus: "active";
    altZh: null;
  };
};

type ProposedCaption = { status: "proposed"; caption: string };
type FailedCaption = { status: "failed"; reason: string };

export type ManifestImageRecord = {
  kind: "image";
  image: BackfillImage;
  batchId: string;
  ordinal: string | null;
  result: ProposedCaption | FailedCaption;
};

export type ManifestSummary = {
  kind: "summary";
  total: number;
  proposed: number;
  failed: number;
  checksumAlgorithm: "sha256";
  checksum: string;
};

export type ParsedManifest = {
  header: ManifestHeader;
  records: ManifestImageRecord[];
  summary: ManifestSummary;
};

export type CaptionBatchParse = {
  captions: Map<string, string>;
  failures: Map<string, string>;
};

export type CurrentImageRow = {
  id: string;
  brand_id: string;
  status: string;
  storage_path: string | null;
  alt_zh: string | null;
};

export type ApplyState =
  "write" | "idempotent" | "replaced" | "changed" | "no_longer_eligible";

type CliOptions =
  { mode: "generate" } | { mode: "apply"; manifestPath: string };

type SelectedImageRow = {
  id: string;
  brand_id: string;
  storage_path: string | null;
  source: string;
  brands:
    | { name: string; slug: string; status: string }
    | Array<{ name: string; slug: string; status: string }>;
};

type ApplyOutcome = {
  state: ApplyState | "failed";
  record: ManifestImageRecord;
  error?: string;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

function normalizeCaption(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const caption = value.trim().replace(/\s+/g, " ");
  const length = characterCount(caption);
  if (length < CAPTION_MIN_CHARACTERS || length > CAPTION_MAX_CHARACTERS) {
    return null;
  }
  return caption;
}

/**
 * Parse model output against the ordinal IDs sent in the request. Every
 * expected ordinal receives either one caption or one failure; array position
 * is never used as identity.
 */
export function parseCaptionBatch(
  responseText: string,
  expectedOrdinals: readonly string[],
): CaptionBatchParse {
  const expected = new Set(expectedOrdinals);
  const captions = new Map<string, string>();
  const failures = new Map<string, string>();
  let parsed: unknown;

  try {
    parsed = JSON.parse(responseText);
  } catch {
    for (const ordinal of expectedOrdinals) {
      failures.set(ordinal, "response was not valid JSON");
    }
    return { captions, failures };
  }

  const values =
    parsed && typeof parsed === "object" && "captions" in parsed
      ? (parsed as { captions?: unknown }).captions
      : null;

  if (!Array.isArray(values)) {
    for (const ordinal of expectedOrdinals) {
      failures.set(ordinal, "response had no captions array");
    }
    return { captions, failures };
  }

  const seen = new Set<string>();
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const { id, caption: rawCaption } = value as {
      id?: unknown;
      caption?: unknown;
    };
    if (typeof id !== "string" || !expected.has(id)) continue;
    if (seen.has(id)) {
      captions.delete(id);
      failures.set(id, "duplicate ordinal in model response");
      continue;
    }
    seen.add(id);

    const caption = normalizeCaption(rawCaption);
    if (!caption) {
      failures.set(
        id,
        `caption must contain ${CAPTION_MIN_CHARACTERS}–${CAPTION_MAX_CHARACTERS} characters`,
      );
      continue;
    }
    captions.set(id, caption);
  }

  for (const ordinal of expectedOrdinals) {
    if (!captions.has(ordinal) && !failures.has(ordinal)) {
      failures.set(ordinal, "missing ordinal in model response");
    }
  }

  return { captions, failures };
}

export function mapCaptionsByImageId(
  images: readonly Pick<BackfillImage, "id">[],
  captionsByOrdinal: ReadonlyMap<string, string>,
): Map<string, string> {
  const captionsByImageId = new Map<string, string>();
  images.forEach((image, index) => {
    const caption = captionsByOrdinal.get(String(index + 1));
    if (caption) captionsByImageId.set(image.id, caption);
  });
  return captionsByImageId;
}

function reviewHash(image: BackfillImage): string {
  return sha256(
    [image.brandId, image.id, image.storagePath, image.source].join(":"),
  );
}

/** Every owner/admin image plus 50 stable hash-selected managed images. */
export function selectReviewImages(
  images: readonly BackfillImage[],
  managedSampleSize: number = REVIEW_MANAGED_SAMPLE_SIZE,
): BackfillImage[] {
  const protectedImages = images
    .filter((image) => image.source === "owner" || image.source === "admin")
    .toSorted((left, right) => left.id.localeCompare(right.id));
  const managedSample = images
    .filter((image) => image.source !== "owner" && image.source !== "admin")
    .toSorted((left, right) => {
      const hashOrder = reviewHash(left).localeCompare(reviewHash(right));
      return hashOrder || left.id.localeCompare(right.id);
    })
    .slice(0, managedSampleSize);

  return [...protectedImages, ...managedSample];
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function summaryWithoutChecksum(records: readonly ManifestImageRecord[]) {
  const proposed = records.filter(
    (record) => record.result.status === "proposed",
  ).length;
  return {
    kind: "summary" as const,
    total: records.length,
    proposed,
    failed: records.length - proposed,
    checksumAlgorithm: "sha256" as const,
  };
}

function manifestChecksum(
  header: ManifestHeader,
  records: readonly ManifestImageRecord[],
): string {
  return sha256(
    stableStringify({
      header,
      records,
      summary: summaryWithoutChecksum(records),
    }),
  );
}

export function serializeManifest(
  header: ManifestHeader,
  records: readonly ManifestImageRecord[],
): string {
  const summary: ManifestSummary = {
    ...summaryWithoutChecksum(records),
    checksum: manifestChecksum(header, records),
  };
  return (
    [header, ...records, summary]
      .map((line) => JSON.stringify(line))
      .join("\n") + "\n"
  );
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(
  value: unknown,
  label: string,
  allowEmpty = false,
): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function parseEnvironment(value: unknown, label: string): SupabaseEnvironment {
  const environment = objectValue(value, label);
  return {
    projectRef: stringValue(environment.projectRef, `${label}.projectRef`),
    host: stringValue(environment.host, `${label}.host`),
  };
}

function parseHeader(value: unknown): ManifestHeader {
  const header = objectValue(value, "manifest header");
  if (header.kind !== "header")
    throw new Error("Manifest must begin with a header");
  if (header.manifestVersion !== MANIFEST_VERSION) {
    throw new Error(
      `Unsupported manifest version ${String(header.manifestVersion)}; expected ${MANIFEST_VERSION}`,
    );
  }
  const provenance = objectValue(header.provenance, "header.provenance");
  const prompt = stringValue(provenance.prompt, "header.provenance.prompt");
  if (provenance.promptSha256 !== sha256(prompt)) {
    throw new Error("Manifest prompt provenance checksum does not match");
  }
  if (
    provenance.model !== MODEL ||
    provenance.profile !== "classifyImages" ||
    provenance.imageDetail !== IMAGE_DETAIL ||
    provenance.reasoningEffort !== "none"
  ) {
    throw new Error(
      "Manifest model provenance does not match the backfill contract",
    );
  }
  const selection = objectValue(header.selection, "header.selection");
  if (
    selection.brandStatus !== "approved" ||
    selection.imageStatus !== "active" ||
    selection.altZh !== null
  ) {
    throw new Error("Manifest selection contract is invalid");
  }
  return {
    kind: "header",
    manifestVersion: MANIFEST_VERSION,
    generatedAt: stringValue(header.generatedAt, "header.generatedAt"),
    environment: parseEnvironment(header.environment, "header.environment"),
    provenance: {
      model: MODEL,
      profile: "classifyImages",
      imageDetail: IMAGE_DETAIL,
      reasoningEffort: "none",
      prompt,
      promptSha256: stringValue(
        provenance.promptSha256,
        "header.provenance.promptSha256",
      ),
    },
    selection: {
      brandStatus: "approved",
      imageStatus: "active",
      altZh: null,
    },
  };
}

function parseImage(value: unknown, line: number): BackfillImage {
  const image = objectValue(value, `Manifest line ${line} image`);
  return {
    id: stringValue(image.id, `Manifest line ${line} image.id`),
    brandId: stringValue(image.brandId, `Manifest line ${line} image.brandId`),
    brandSlug: stringValue(
      image.brandSlug,
      `Manifest line ${line} image.brandSlug`,
    ),
    brandName: stringValue(
      image.brandName,
      `Manifest line ${line} image.brandName`,
    ),
    source: stringValue(image.source, `Manifest line ${line} image.source`),
    storagePath: stringValue(
      image.storagePath,
      `Manifest line ${line} image.storagePath`,
      true,
    ),
  };
}

function parseImageRecord(value: unknown, line: number): ManifestImageRecord {
  const record = objectValue(value, `Manifest line ${line}`);
  if (record.kind !== "image") {
    throw new Error(`Manifest line ${line} must be an image record`);
  }
  const result = objectValue(record.result, `Manifest line ${line} result`);
  let parsedResult: ProposedCaption | FailedCaption;
  if (result.status === "proposed") {
    const rawCaption = stringValue(
      result.caption,
      `Manifest line ${line} result.caption`,
    );
    const caption = normalizeCaption(rawCaption);
    if (!caption || caption !== rawCaption) {
      throw new Error(
        `Manifest line ${line} caption is not normalized or valid`,
      );
    }
    parsedResult = { status: "proposed", caption };
  } else if (result.status === "failed") {
    parsedResult = {
      status: "failed",
      reason: stringValue(result.reason, `Manifest line ${line} result.reason`),
    };
  } else {
    throw new Error(`Manifest line ${line} result has an unknown status`);
  }

  const image = parseImage(record.image, line);
  if (parsedResult.status === "proposed" && !image.storagePath) {
    throw new Error(
      `Manifest line ${line} proposes a caption without a storage identity`,
    );
  }

  return {
    kind: "image",
    image,
    batchId: stringValue(record.batchId, `Manifest line ${line} batchId`),
    ordinal:
      record.ordinal === null
        ? null
        : stringValue(record.ordinal, `Manifest line ${line} ordinal`),
    result: parsedResult,
  };
}

export function parseManifest(contents: string): ParsedManifest {
  const rawLines = contents
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (rawLines.length < 2) throw new Error("Manifest is incomplete");

  const parsedLines = rawLines.map((line, index) => {
    try {
      return JSON.parse(line) as unknown;
    } catch {
      throw new Error(`Manifest line ${index + 1} is not valid JSON`);
    }
  });
  const header = parseHeader(parsedLines[0]);
  const rawSummary = objectValue(parsedLines.at(-1), "manifest summary");
  if (rawSummary.kind !== "summary") {
    throw new Error("Manifest must end with a summary");
  }
  const records = parsedLines
    .slice(1, -1)
    .map((value, index) => parseImageRecord(value, index + 2));
  const expectedSummary = summaryWithoutChecksum(records);
  if (
    rawSummary.total !== expectedSummary.total ||
    rawSummary.proposed !== expectedSummary.proposed ||
    rawSummary.failed !== expectedSummary.failed ||
    rawSummary.checksumAlgorithm !== "sha256"
  ) {
    throw new Error("Manifest summary counts do not match its image records");
  }
  const checksum = stringValue(
    rawSummary.checksum,
    "manifest summary checksum",
  );
  if (checksum !== manifestChecksum(header, records)) {
    throw new Error("Manifest checksum does not match its contents");
  }
  const uniqueIds = new Set(records.map((record) => record.image.id));
  if (uniqueIds.size !== records.length) {
    throw new Error("Manifest contains duplicate image IDs");
  }

  return {
    header,
    records,
    summary: { ...expectedSummary, checksum },
  };
}

export function assertManifestEnvironment(
  manifest: ParsedManifest,
  current: SupabaseEnvironment,
): void {
  const expected = manifest.header.environment;
  if (
    expected.projectRef !== current.projectRef ||
    expected.host !== current.host
  ) {
    throw new Error(
      `Manifest belongs to another Supabase project: ${expected.projectRef} (${expected.host}); current connection is ${current.projectRef} (${current.host})`,
    );
  }
}

function proposedCaption(record: ManifestImageRecord): string {
  if (record.result.status !== "proposed") {
    throw new Error(`Image ${record.image.id} has no proposed caption`);
  }
  return record.result.caption;
}

export function buildAltOnlyUpdate(record: ManifestImageRecord) {
  return {
    values: { alt_zh: proposedCaption(record) },
    conditions: {
      id: record.image.id,
      brand_id: record.image.brandId,
      status: "active" as const,
      alt_zh: null,
      storage_path: record.image.storagePath,
    },
  };
}

export function classifyApplyState(
  record: ManifestImageRecord,
  current: CurrentImageRow | null,
): ApplyState {
  const caption = proposedCaption(record);
  if (!current) return "no_longer_eligible";
  if (current.alt_zh === caption) return "idempotent";
  if (current.alt_zh !== null) return "changed";
  if (current.storage_path !== record.image.storagePath) return "replaced";
  if (
    current.id !== record.image.id ||
    current.brand_id !== record.image.brandId ||
    current.status !== "active"
  ) {
    return "no_longer_eligible";
  }
  return "write";
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  const generate = argv.includes("--generate");
  const applyIndex = argv.indexOf("--apply");
  if (generate && applyIndex >= 0) {
    throw new Error(
      "Pass either --generate or --apply <manifest.ndjson>, not both",
    );
  }
  if (generate) {
    if (argv.length !== 1)
      throw new Error("--generate does not accept other arguments");
    return { mode: "generate" };
  }
  if (applyIndex >= 0) {
    const manifestPath = argv.at(applyIndex + 1);
    if (
      applyIndex !== 0 ||
      argv.length !== 2 ||
      !manifestPath ||
      manifestPath.startsWith("--")
    ) {
      throw new Error("--apply requires exactly one manifest path");
    }
    return { mode: "apply", manifestPath };
  }
  throw new Error(
    "Nothing to do. Run --generate, review the artifacts, then run --apply <manifest.ndjson>",
  );
}

export function supabaseEnvironment(
  url: string | undefined,
): SupabaseEnvironment {
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required");
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid URL");
  }
  const hosted = /^([a-z0-9-]+)\.supabase\.(?:co|in|net)$/i.exec(host);
  return {
    projectRef: hosted ? hosted[1]! : host.replace(/[^a-z0-9-]+/gi, "-"),
    host,
  };
}

function assertDatabaseConfigured(): SupabaseEnvironment {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  }
  return supabaseEnvironment(process.env.NEXT_PUBLIC_SUPABASE_URL);
}

function brandRelation(row: SelectedImageRow) {
  return Array.isArray(row.brands) ? row.brands[0] : row.brands;
}

async function readEligibleImages(): Promise<BackfillImage[]> {
  const supabase = createServiceClient();
  const images: BackfillImage[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("brand_images")
      .select(
        "id, brand_id, storage_path, source, brands!inner(name, slug, status)",
      )
      .eq("status", "active")
      .is("alt_zh", null)
      .eq("brands.status", "approved")
      .order("brand_id", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error)
      throw new Error(`Failed to read eligible images: ${error.message}`);
    const page = (data ?? []) as unknown as SelectedImageRow[];
    for (const row of page) {
      const brand = brandRelation(row);
      if (!brand || brand.status !== "approved") continue;
      images.push({
        id: row.id,
        brandId: row.brand_id,
        brandSlug: brand.slug,
        brandName: brand.name,
        source: row.source,
        storagePath: row.storage_path ?? "",
      });
    }
    if (page.length < PAGE_SIZE) break;
  }

  return images;
}

function captionSchema(ordinals: readonly string[]) {
  return {
    name: "brand_image_alt_zh_captions",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["captions"],
      properties: {
        captions: {
          type: "array",
          minItems: ordinals.length,
          maxItems: ordinals.length,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "caption"],
            properties: {
              id: { type: "string", enum: ordinals },
              caption: {
                type: "string",
                minLength: CAPTION_MIN_CHARACTERS,
                maxLength: CAPTION_MAX_CHARACTERS,
              },
            },
          },
        },
      },
    },
  };
}

function failedRecord(
  image: BackfillImage,
  batchId: string,
  ordinal: string | null,
  reason: string,
): ManifestImageRecord {
  return {
    kind: "image",
    image,
    batchId,
    ordinal,
    result: { status: "failed", reason },
  };
}

async function generateBatch(
  client: ReturnType<typeof createProfiledOpenAIClient>,
  batch: readonly BackfillImage[],
  batchId: string,
  reviewIds: ReadonlySet<string>,
  reviewDataUris: Map<string, string>,
): Promise<ManifestImageRecord[]> {
  const loaded = await mapWithConcurrency(
    batch,
    IMAGE_LOAD_CONCURRENCY,
    async (image) => {
      if (!image.storagePath) return { image, dataUri: null };
      const dataUri = await loadVisionDataUri({
        storage_path: image.storagePath,
      });
      if (dataUri && reviewIds.has(image.id))
        reviewDataUris.set(image.id, dataUri);
      return { image, dataUri };
    },
  );
  const records = loaded
    .filter(({ dataUri }) => !dataUri)
    .map(({ image }) =>
      failedRecord(
        image,
        batchId,
        null,
        image.storagePath ? "image unreadable" : "missing storage identity",
      ),
    );
  const sendable = loaded.filter(
    (entry): entry is { image: BackfillImage; dataUri: string } =>
      entry.dataUri !== null,
  );
  if (sendable.length === 0) return records;

  const ordinals = sendable.map((_, index) => String(index + 1));
  let response;
  try {
    response = await client.chat({
      system: CAPTION_PROMPT,
      user: `依照附圖順序，為編號 ${ordinals.join("、")} 的 ${sendable.length} 張圖片各寫一則替代文字。回傳 captions 陣列，每個物件的 id 必須對應圖片編號。`,
      images: sendable.map((entry) => entry.dataUri),
      imageDetail: IMAGE_DETAIL,
      json: true,
      schema: captionSchema(ordinals),
      ...profileChatParams("classifyImages", {
        maxTokens: 200 * sendable.length,
        reasoningEffort: "none",
        timeoutMs: 120_000,
      }),
      meta: {
        backfill: "DEV-1630",
        batchId,
        brandId: batch[0]?.brandId,
        imageIds: sendable.map((entry) => entry.image.id),
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return [
      ...records,
      ...sendable.map(({ image }, index) =>
        failedRecord(image, batchId, ordinals[index]!, reason),
      ),
    ];
  }

  if (!response.ok || !response.content) {
    const reason = response.refusal
      ? `model refusal: ${response.refusal}`
      : `OpenAI request failed with status ${response.status}`;
    return [
      ...records,
      ...sendable.map(({ image }, index) =>
        failedRecord(image, batchId, ordinals[index]!, reason),
      ),
    ];
  }

  const parsed = parseCaptionBatch(response.content, ordinals);
  sendable.forEach(({ image }, index) => {
    const ordinal = ordinals[index]!;
    const caption = parsed.captions.get(ordinal);
    records.push(
      caption
        ? {
            kind: "image",
            image,
            batchId,
            ordinal,
            result: { status: "proposed", caption },
          }
        : failedRecord(
            image,
            batchId,
            ordinal,
            parsed.failures.get(ordinal) ?? "caption missing",
          ),
    );
  });
  return records;
}

function renderReviewHtml(
  manifest: ParsedManifest,
  reviewImages: readonly BackfillImage[],
  reviewDataUris: ReadonlyMap<string, string>,
): string {
  const records = new Map(
    manifest.records.map((record) => [record.image.id, record]),
  );
  const cards = reviewImages
    .map((image) => {
      const record = records.get(image.id);
      const dataUri = reviewDataUris.get(image.id);
      const result = record?.result;
      const text =
        result?.status === "proposed"
          ? result.caption
          : `Generation failed: ${result?.reason ?? "missing record"}`;
      return `<article>
        <div class="image">${dataUri ? `<img src="${esc(dataUri)}" alt="">` : "<span>Image unavailable</span>"}</div>
        <div class="body">
          <h2>${esc(image.brandName)}</h2>
          <p class="meta">${esc(image.brandSlug)} · ${esc(image.source)} · ${esc(image.id)}</p>
          <p class="caption ${result?.status === "proposed" ? "" : "failure"}">${esc(text)}</p>
        </div>
      </article>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DEV-1630 alt_zh review</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; background: #f6f4ef; color: #25231f; }
    body { max-width: 1200px; margin: 0 auto; padding: 32px 20px 64px; }
    header { margin-bottom: 28px; }
    h1 { font-size: 28px; margin-bottom: 8px; }
    header p, .meta { color: #625e55; }
    main { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 18px; }
    article { overflow: hidden; border: 1px solid #d8d3c9; border-radius: 12px; background: white; box-shadow: 0 2px 10px rgb(37 35 31 / 7%); }
    .image { min-height: 260px; display: grid; place-items: center; background: #ece8df; color: #625e55; }
    img { display: block; width: 100%; height: 300px; object-fit: contain; }
    .body { padding: 16px; }
    h2 { margin: 0 0 6px; font-size: 18px; }
    p { margin: 8px 0 0; line-height: 1.6; }
    .meta { font-size: 12px; overflow-wrap: anywhere; }
    .caption { font-size: 16px; }
    .failure { color: #a33a2b; }
  </style>
</head>
<body>
  <header>
    <h1>DEV-1630 alt_zh review</h1>
    <p>${esc(manifest.header.environment.projectRef)} · ${manifest.summary.proposed} proposed · ${manifest.summary.failed} failed · ${reviewImages.length} reviewed</p>
    <p>Manifest checksum: <code>${esc(manifest.summary.checksum)}</code></p>
  </header>
  <main>${cards}</main>
</body>
</html>\n`;
}

async function generate(): Promise<number> {
  const environment = assertDatabaseConfigured();
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is required for --generate");
  }
  const model = resolveProfileModel("classifyImages");
  if (model !== MODEL) {
    throw new Error(
      `--generate is pinned to ${MODEL}; clear OPENAI_MODEL_OVERRIDE (resolved ${model})`,
    );
  }

  const images = await readEligibleImages();
  const reviewImages = selectReviewImages(images);
  const reviewIds = new Set(reviewImages.map((image) => image.id));
  const reviewDataUris = new Map<string, string>();
  const generatedAt = new Date();
  const header: ManifestHeader = {
    kind: "header",
    manifestVersion: MANIFEST_VERSION,
    generatedAt: generatedAt.toISOString(),
    environment,
    provenance: {
      model,
      profile: "classifyImages",
      imageDetail: IMAGE_DETAIL,
      reasoningEffort: "none",
      prompt: CAPTION_PROMPT,
      promptSha256: sha256(CAPTION_PROMPT),
    },
    selection: {
      brandStatus: "approved",
      imageStatus: "active",
      altZh: null,
    },
  };
  const client = createProfiledOpenAIClient("classifyImages", {
    phase: "backfill_brand_image_alt_zh",
    config: header.provenance,
  });
  const byBrand = new Map<string, BackfillImage[]>();
  for (const image of images) {
    const brandImages = byBrand.get(image.brandId) ?? [];
    brandImages.push(image);
    byBrand.set(image.brandId, brandImages);
  }

  const records: ManifestImageRecord[] = [];
  for (const [brandId, brandImages] of byBrand) {
    for (let index = 0; index < brandImages.length; index += IMAGE_BATCH_SIZE) {
      const batch = brandImages.slice(index, index + IMAGE_BATCH_SIZE);
      const batchId = `${brandId}:${Math.floor(index / IMAGE_BATCH_SIZE) + 1}`;
      records.push(
        ...(await generateBatch(
          client,
          batch,
          batchId,
          reviewIds,
          reviewDataUris,
        )),
      );
    }
  }

  const contents = serializeManifest(header, records);
  const manifest = parseManifest(contents);
  const name = `brand-image-alt-zh_${environment.projectRef}`;
  const manifestPath = artifactPath(name, {
    prefix: "",
    ext: "ndjson",
    suffix: process.pid,
    now: generatedAt,
  });
  const reviewPath = artifactPath(name, {
    prefix: "review",
    ext: "html",
    suffix: process.pid,
    now: generatedAt,
  });
  await mkdir(dirname(manifestPath), { recursive: true });
  await Promise.all([
    writeFile(manifestPath, contents, "utf8"),
    writeFile(
      reviewPath,
      renderReviewHtml(manifest, reviewImages, reviewDataUris),
      "utf8",
    ),
  ]);

  console.log(
    JSON.stringify({
      mode: "generate",
      environment,
      selected: images.length,
      proposed: manifest.summary.proposed,
      failed: manifest.summary.failed,
      manifestPath,
      reviewPath,
      checksum: manifest.summary.checksum,
    }),
  );
  return manifest.summary.failed > 0 ? 1 : 0;
}

async function applyOne(record: ManifestImageRecord): Promise<ApplyOutcome> {
  const supabase = createServiceClient();
  const plan = buildAltOnlyUpdate(record);
  const { data, error } = await supabase
    .from("brand_images")
    .update(plan.values)
    .eq("id", plan.conditions.id)
    .eq("brand_id", plan.conditions.brand_id)
    .eq("status", plan.conditions.status)
    .is("alt_zh", plan.conditions.alt_zh)
    .eq("storage_path", plan.conditions.storage_path)
    .select("id")
    .maybeSingle();

  if (error) {
    return { state: "failed", record, error: error.message };
  }
  if (data) return { state: "write", record };

  const { data: current, error: readError } = await supabase
    .from("brand_images")
    .select("id, brand_id, status, storage_path, alt_zh")
    .eq("id", record.image.id)
    .maybeSingle();
  if (readError) {
    return { state: "failed", record, error: readError.message };
  }
  const state = classifyApplyState(record, current as CurrentImageRow | null);
  return state === "write"
    ? {
        state: "failed",
        record,
        error: "conditional update matched no row despite an eligible reread",
      }
    : { state, record };
}

async function apply(manifestPath: string): Promise<number> {
  const environment = assertDatabaseConfigured();
  const manifest = parseManifest(await readFile(manifestPath, "utf8"));
  assertManifestEnvironment(manifest, environment);
  assertRevalidationConfigured();

  const proposed = manifest.records.filter(
    (record): record is ManifestImageRecord & { result: ProposedCaption } =>
      record.result.status === "proposed",
  );
  const outcomes = await mapWithConcurrency(
    proposed,
    APPLY_CONCURRENCY,
    applyOne,
  );
  const successfulSlugs = [
    ...new Set(
      outcomes
        .filter((outcome) => outcome.state === "write")
        .map((outcome) => outcome.record.image.brandSlug),
    ),
  ];
  const revalidation = await requestPublicBrandRevalidation(successfulSlugs);
  const counts = Object.fromEntries(
    [
      "write",
      "idempotent",
      "replaced",
      "changed",
      "no_longer_eligible",
      "failed",
    ].map((state) => [
      state,
      outcomes.filter((outcome) => outcome.state === state).length,
    ]),
  );
  const failures = outcomes
    .filter((outcome) => outcome.state === "failed")
    .map((outcome) => ({
      imageId: outcome.record.image.id,
      error: outcome.error ?? "unknown error",
    }));

  console.log(
    JSON.stringify({
      mode: "apply",
      environment,
      manifestPath,
      manifestChecksum: manifest.summary.checksum,
      generationFailures: manifest.summary.failed,
      ...counts,
      revalidatedBrands: successfulSlugs.length,
      revalidation,
      failures,
    }),
  );

  const drifted =
    (counts.replaced ?? 0) +
    (counts.changed ?? 0) +
    (counts.no_longer_eligible ?? 0);
  const partial =
    manifest.summary.failed > 0 ||
    drifted > 0 ||
    (counts.failed ?? 0) > 0 ||
    !revalidation.ok;
  return partial ? 1 : 0;
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  process.exitCode =
    options.mode === "generate"
      ? await generate()
      : await apply(options.manifestPath);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
