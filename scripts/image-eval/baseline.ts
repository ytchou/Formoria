import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createOpenAIClient,
  parseJson,
  type ChatAuditEvent,
} from "@/lib/services/openai-client";
import { LEGACY_IMAGE_CLASSIFY_SYSTEM_PROMPT } from "@/lib/prompts";
import { PRODUCT_TYPE_CATEGORIES } from "@/lib/taxonomy/ontology";
import { createImageEvalSignedUrls } from "@/lib/services/image-eval-storage";
import {
  MANIFEST_PATH,
  RUN_ROOT,
  ensureEvalDirectories,
  readJson,
  runPath,
  writeJsonAtomic,
} from "./lib/paths";
import { tagFromLegacyTag } from "./lib/scoring";
import type {
  EvalPrediction,
  GoldenImageEntry,
  GoldenManifest,
  GoldenSplit,
} from "./lib/types";

const BATCH_SIZE = 20;
const MODEL = "gpt-4o-mini";
const CLASSIFICATION_SCHEMA = {
  name: "image_classifications",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      classifications: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            tag: {
              type: "string",
              enum: [
                "product",
                "lifestyle",
                "packaging",
                "logo",
                "promo",
                "text_banner",
                "irrelevant",
              ],
            },
            score: { type: "number" },
            alt_zh: { type: "string" },
            alt_en: { type: "string" },
          },
          required: ["id", "tag", "score", "alt_zh", "alt_en"],
        },
      },
    },
    required: ["classifications"],
  },
} as const;

type RawClassification = { id?: unknown; tag?: unknown; score?: unknown };

function splitArg(): GoldenSplit | "all" {
  const argument = process.argv.find((value) => value.startsWith("--split="));
  const value = argument?.slice("--split=".length) ?? "dev";
  if (value !== "dev" && value !== "holdout" && value !== "all")
    throw new Error("--split must be dev, holdout, or all");
  return value;
}

function parseClassifications(content: string): Map<string, RawClassification> {
  const parsed = parseJson<unknown>(content);
  if (!parsed || typeof parsed !== "object") return new Map();
  const values = (parsed as { classifications?: unknown }).classifications;
  if (!Array.isArray(values)) return new Map();
  return new Map(
    values.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const item = value as RawClassification;
      const id = typeof item.id === "string" ? item.id.trim() : "";
      return id ? [[id, item] as const] : [];
    }),
  );
}

function rejectionReasons(tag: string): EvalPrediction["reasons"] {
  if (tag === "promo") return ["promo_subject"];
  if (tag === "text_banner") return ["text_dominant"];
  if (tag === "irrelevant") return ["irrelevant"];
  return ["low_visual_quality"];
}

function brandContext(entry: GoldenImageEntry): string {
  const category = PRODUCT_TYPE_CATEGORIES.find(
    (candidate) => candidate.slug === entry.category,
  )?.nameZh;
  return category
    ? `品牌：${entry.brandName}（${category}）。`
    : `品牌：${entry.brandName}。`;
}

function latestRunId(): string {
  return `baseline-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

async function auditWriter(path: string, event: ChatAuditEvent): Promise<void> {
  await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
}

async function runBaseline(): Promise<void> {
  await ensureEvalDirectories();
  const manifest = await readJson<GoldenManifest>(MANIFEST_PATH);
  const selectedSplit = splitArg();
  const entries = manifest.entries.filter(
    (entry) =>
      entry.captureStatus === "ready" &&
      (selectedSplit === "all" || entry.split === selectedSplit),
  );
  if (entries.length === 0)
    throw new Error(`No ready entries for split ${selectedSplit}`);

  const runId = latestRunId();
  await mkdir(join(RUN_ROOT, runId), { recursive: true });
  const callsPath = runPath(runId, "calls.jsonl");
  const signedUrls = await createImageEvalSignedUrls(
    entries.flatMap((entry) => (entry.objectPath ? [entry.objectPath] : [])),
  );
  const predictions: EvalPrediction[] = [];
  const client = createOpenAIClient({
    model: MODEL,
    onChatComplete: (event) => auditWriter(callsPath, event),
  });

  const entriesByBrand = new Map<string, GoldenImageEntry[]>();
  for (const entry of entries) {
    const brandEntries = entriesByBrand.get(entry.brandId) ?? [];
    brandEntries.push(entry);
    entriesByBrand.set(entry.brandId, brandEntries);
  }

  let completed = 0;
  for (const brandEntries of entriesByBrand.values()) {
    for (let offset = 0; offset < brandEntries.length; offset += BATCH_SIZE) {
      const chunk = brandEntries.slice(offset, offset + BATCH_SIZE);
      const ids = chunk.map((_entry, index) => String(index + 1));
      const images = chunk.map((entry) =>
        entry.objectPath ? signedUrls.get(entry.objectPath) : undefined,
      );
      if (images.some((url) => !url)) {
        predictions.push(
          ...chunk.map((entry) => ({
            imageId: entry.id,
            disposition: "reject" as const,
            tag: null,
            reasons: ["low_visual_quality" as const],
            score: null,
            error: "missing signed URL",
          })),
        );
        completed += chunk.length;
        continue;
      }

      const response = await client.chat({
        system: LEGACY_IMAGE_CLASSIFY_SYSTEM_PROMPT,
        user: `${brandContext(chunk[0])}請分類以下 ${chunk.length} 張品牌圖片，依序編號為 ${ids.join("、")}。回傳 JSON object，包含 classifications 陣列，每個物件的 id 必須是對應圖片的編號字串。無法判斷的圖片請省略，不要猜測。`,
        images: images.filter((url): url is string => Boolean(url)),
        json: true,
        schema: CLASSIFICATION_SCHEMA,
        maxTokens: 250 * chunk.length,
        temperature: 0,
        meta: {
          imageIds: chunk.map((entry) => entry.id),
          split: selectedSplit,
        },
      });
      const parsed = response.content
        ? parseClassifications(response.content)
        : new Map<string, RawClassification>();

      for (const [index, entry] of chunk.entries()) {
        const raw = parsed.get(String(index + 1));
        const tag = typeof raw?.tag === "string" ? raw.tag : null;
        const score =
          typeof raw?.score === "number" && Number.isFinite(raw.score)
            ? Math.max(0, Math.min(100, Math.round(raw.score)))
            : null;
        if (!response.ok || !tag) {
          predictions.push({
            imageId: entry.id,
            disposition: "reject",
            tag: null,
            reasons: ["low_visual_quality"],
            score,
            error: response.ok
              ? "missing model verdict"
              : `request failed (HTTP ${response.status})`,
          });
          continue;
        }
        const mapped = tagFromLegacyTag(tag);
        predictions.push({
          imageId: entry.id,
          disposition: mapped.disposition,
          tag: mapped.tag,
          reasons: mapped.disposition === "reject" ? rejectionReasons(tag) : [],
          score,
          error: null,
        });
      }
      completed += chunk.length;
      console.log(`  classified ${completed}/${entries.length}`);
    }
  }

  await writeJsonAtomic(runPath(runId, "predictions.json"), {
    schemaVersion: 1,
    corpusId: manifest.corpusId,
    model: MODEL,
    split: selectedSplit,
    createdAt: new Date().toISOString(),
    predictions,
  });
  console.log(`Baseline complete: ${predictions.length} predictions`);
  console.log(`Run: ${runId}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runBaseline().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
