import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createOpenAIClient,
  parseJson,
  type ChatAuditEvent,
} from "@/lib/services/openai-client";
import {
  IMAGE_CLASSIFY_SYSTEM_PROMPT,
  LEGACY_IMAGE_CLASSIFY_SYSTEM_PROMPT,
} from "@/lib/prompts";
import { classifyHttpResponse, IN_PROCESS, withRetry } from "@/lib/retry";
import { PRODUCT_TYPE_CATEGORIES } from "@/lib/taxonomy/ontology";
import { buildBrandContext } from "@/lib/services/enrich-phases/classify-images";
import { createImageEvalSignedUrls } from "@/lib/services/image-eval-storage";
import {
  MANIFEST_PATH,
  LABELS_PATH,
  RUN_ROOT,
  ensureEvalDirectories,
  readJson,
  runPath,
  writeJsonAtomic,
} from "./lib/paths";
import { defaultTagDefinitions, hydrateLabelsFile } from "./lib/labels";
import {
  REVIEW_HOLDOUT_COUNT,
  REVIEW_QUEUE_SEED,
  reviewQueue,
} from "./lib/review";
import { tagFromLegacyTag } from "./lib/scoring";
import type {
  EvalPrediction,
  GoldenImageEntry,
  GoldenLabelsFile,
  GoldenManifest,
  GoldenSplit,
} from "./lib/types";

/** Mirrors BATCH_SIZE in classify-images.ts — batch length changes the verdicts. */
const BATCH_SIZE = 5;
/** Default stays on the incumbent so existing runs and the tracked baseline are unaffected. */
const DEFAULT_MODEL = "gpt-4o-mini";
const REJECTION_TAGS = ["promo", "text_banner", "irrelevant"];

/**
 * The line of IMAGE_CLASSIFY_SYSTEM_PROMPT the dynamic tag registry replaces.
 * Must stay byte-identical to `src/lib/prompts.ts`; `buildSystemPrompt` throws
 * if it drifts rather than silently emitting the unmodified prompt.
 */
const KEEP_TAG_PROMPT_ANCHOR =
  '- keep: "tag" is "product" or "logo", and "reasons" is [].';

function classificationSchema(
  keptTags: readonly string[],
  prompt: "legacy" | "current",
) {
  const properties =
    prompt === "current"
      ? {
          id: { type: "string" },
          disposition: { type: "string", enum: ["keep", "reject"] },
          tag: {
            anyOf: [{ type: "string", enum: [...keptTags] }, { type: "null" }],
          },
          reasons: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "wrong_brand",
                "time_sensitive",
                "promo_subject",
                "text_dominant",
                "low_visual_quality",
                // No "duplicate" — mirrors REJECTION_REASONS in
                // classify-images.ts, where dedupe belongs to the download
                // layer. The human label vocabulary still has it, deliberately:
                // a reviewer may mark a duplicate the model can no longer emit.
                "irrelevant",
              ],
            },
          },
          score: { type: "number" },
          alt_zh: { type: "string" },
          alt_en: { type: "string" },
        }
      : {
          id: { type: "string" },
          tag: { type: "string", enum: [...keptTags, ...REJECTION_TAGS] },
          score: { type: "number" },
          alt_zh: { type: "string" },
          alt_en: { type: "string" },
        };
  return {
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
            properties,
            required: Object.keys(properties),
          },
        },
      },
      required: ["classifications"],
    },
  };
}

type RawClassification = {
  id?: unknown;
  disposition?: unknown;
  tag?: unknown;
  reasons?: unknown;
  score?: unknown;
};

function splitArg(): GoldenSplit | "all" {
  const argument = process.argv.find((value) => value.startsWith("--split="));
  const value = argument?.slice("--split=".length) ?? "dev";
  if (value !== "dev" && value !== "holdout" && value !== "all")
    throw new Error("--split must be dev, holdout, or all");
  return value;
}

function promptArg(): "legacy" | "current" {
  const argument = process.argv.find((value) => value.startsWith("--prompt="));
  const value = argument?.slice("--prompt=".length) ?? "legacy";
  if (value !== "legacy" && value !== "current")
    throw new Error("--prompt must be legacy or current");
  return value;
}

function scopeArg(): "manifest" | "review" {
  const argument = process.argv.find((value) => value.startsWith("--scope="));
  const value = argument?.slice("--scope=".length) ?? "manifest";
  if (value !== "manifest" && value !== "review")
    throw new Error("--scope must be manifest or review");
  return value;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

/** `--model=` exists so one corpus can be scored against two models in the same session. */
function modelArg(): string {
  const argument = process.argv.find((value) => value.startsWith("--model="));
  const value = argument?.slice("--model=".length) ?? DEFAULT_MODEL;
  if (value.trim().length === 0) throw new Error("--model must not be empty");
  return value;
}

function paceMsArg(): number {
  const argument = process.argv.find((value) => value.startsWith("--pace-ms="));
  const value = argument ? Number(argument.slice("--pace-ms=".length)) : 0;
  if (!Number.isFinite(value) || value < 0)
    throw new Error("--pace-ms must be a non-negative number");
  return value;
}

async function loadTagDefinitions(): Promise<
  GoldenLabelsFile["tagDefinitions"]
> {
  try {
    const labelsFile = await readJson<GoldenLabelsFile>(LABELS_PATH);
    return hydrateLabelsFile(labelsFile).tagDefinitions;
  } catch {
    return defaultTagDefinitions();
  }
}

async function loadLabeledImageIds(): Promise<Set<string>> {
  try {
    const labelsFile = await readJson<GoldenLabelsFile>(LABELS_PATH);
    return new Set(Object.keys(labelsFile.labels));
  } catch {
    return new Set();
  }
}

function tagRegistryGuidance(
  tagDefinitions: NonNullable<GoldenLabelsFile["tagDefinitions"]>,
): string {
  const lines = Object.values(tagDefinitions).map(
    (definition) => `- ${definition.slug}: ${definition.description}`,
  );
  return `本次評估的 primary keep tag 註冊表如下，請只從這些 tag 選擇可保留圖片：\n${lines.join("\n")}`;
}

function buildSystemPrompt(
  prompt: "legacy" | "current",
  tagDefinitions: NonNullable<GoldenLabelsFile["tagDefinitions"]>,
): string {
  const base =
    prompt === "current"
      ? IMAGE_CLASSIFY_SYSTEM_PROMPT
      : LEGACY_IMAGE_CLASSIFY_SYSTEM_PROMPT;
  if (prompt === "legacy") return base;
  const tags = Object.keys(tagDefinitions).join(", ");
  // The dynamic tag registry is injected by rewriting this exact line of the
  // production prompt. A silent no-op here would leave the harness measuring the
  // production tag list while reporting the registry's, so a missing anchor is a
  // hard failure: it means the prompt changed and this matcher did not.
  if (!base.includes(KEEP_TAG_PROMPT_ANCHOR)) {
    throw new Error(
      `IMAGE_CLASSIFY_SYSTEM_PROMPT no longer contains the keep-tag anchor line.\n` +
        `Expected: ${KEEP_TAG_PROMPT_ANCHOR}\n` +
        `Update KEEP_TAG_PROMPT_ANCHOR in scripts/image-eval/baseline.ts to match the prompt.`,
    );
  }
  return `${base.replace(
    KEEP_TAG_PROMPT_ANCHOR,
    `- keep: "tag" is one of ${tags}, and "reasons" is [].`,
  )}\n\n${tagRegistryGuidance(tagDefinitions)}`;
}

/**
 * Must stay in sync with the production user message in
 * `src/lib/services/enrich-phases/classify-images.ts` — the harness measures
 * production only if it sends what production sends. The legacy branch keeps
 * the original Chinese wording it was calibrated against.
 */
function classifyInstruction(
  prompt: "legacy" | "current",
  count: number,
  ids: readonly string[],
): string {
  if (prompt === "legacy") {
    return `請分類以下 ${count} 張品牌圖片，依序編號為 ${ids.join("、")}。回傳 JSON object，包含 classifications 陣列，每個物件的 id 必須是對應圖片的編號字串。無法判斷的圖片請省略，不要猜測。`;
  }
  return `Classify the ${count} brand images that follow, numbered ${ids.join(", ")} in order. Return a JSON object with a "classifications" array holding exactly ${count} objects, whose "id" values are the image numbers as strings. Do not omit any image.`;
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

const VALID_REJECTION_REASONS: ReadonlySet<EvalPrediction["reasons"][number]> =
  new Set([
    "wrong_brand",
    "time_sensitive",
    "promo_subject",
    "text_dominant",
    "low_visual_quality",
    "duplicate",
    "irrelevant",
  ]);

function parsedRejectionReasons(
  value: unknown,
  fallbackTag: string | null,
): EvalPrediction["reasons"] {
  const reasons = Array.isArray(value)
    ? value.filter(
        (reason): reason is EvalPrediction["reasons"][number] =>
          typeof reason === "string" &&
          VALID_REJECTION_REASONS.has(reason as never),
      )
    : [];
  return reasons.length > 0
    ? [...new Set(reasons)]
    : rejectionReasons(fallbackTag ?? "");
}

function currentPrediction(
  raw: RawClassification | undefined,
  keptTags: ReadonlySet<string>,
): { disposition: "keep" | "reject"; tag: string | null } {
  const tag = typeof raw?.tag === "string" ? raw.tag : null;
  if (
    raw?.disposition === "keep" &&
    tag !== null &&
    keptTags.has(tag) &&
    Array.isArray(raw.reasons) &&
    raw.reasons.length === 0
  ) {
    return { disposition: "keep", tag };
  }
  return { disposition: "reject", tag: null };
}

/**
 * The legacy prompt was calibrated against the Chinese context, so it keeps it.
 * The current prompt shares production's builder verbatim — a private copy here
 * is how the harness silently stops measuring production. The corpus manifest
 * carries no website, so that field is null until the next capture.
 */
function brandContext(
  entry: GoldenImageEntry,
  prompt: "legacy" | "current",
): string {
  if (prompt === "legacy") {
    const category = PRODUCT_TYPE_CATEGORIES.find(
      (candidate) => candidate.slug === entry.category,
    )?.nameZh;
    return category
      ? `品牌：${entry.brandName}（${category}）。`
      : `品牌：${entry.brandName}。`;
  }
  return buildBrandContext({
    name: entry.brandName,
    productType: entry.category,
    website: null,
  });
}

function latestRunId(): string {
  return `baseline-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

async function auditWriter(path: string, event: ChatAuditEvent): Promise<void> {
  await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
}

async function chatWithRetry(
  client: ReturnType<typeof createOpenAIClient>,
  input: Parameters<ReturnType<typeof createOpenAIClient>["chat"]>[0],
): Promise<Awaited<ReturnType<ReturnType<typeof createOpenAIClient>["chat"]>>> {
  return withRetry(IN_PROCESS, () => client.chat(input), {
    classify: classifyHttpResponse,
    onRetry: ({ attemptIndex, delayMs }) => {
      console.warn(
        `  [OPENAI] Retrying in ${delayMs}ms (attempt ${attemptIndex}/${IN_PROCESS.attempts})`,
      );
    },
    service: "image-eval",
  });
}

async function runBaseline(): Promise<void> {
  await ensureEvalDirectories();
  const manifest = await readJson<GoldenManifest>(MANIFEST_PATH);
  const selectedSplit = splitArg();
  const prompt = promptArg();
  const scope = scopeArg();
  const model = modelArg();
  const unlabeledOnly = hasFlag("--unlabeled-only");
  const paceMs = paceMsArg();
  const tagDefinitions =
    (await loadTagDefinitions()) ?? defaultTagDefinitions();
  const keptTags = Object.keys(tagDefinitions);
  const systemPrompt = buildSystemPrompt(prompt, tagDefinitions);
  const labeledImageIds = unlabeledOnly
    ? await loadLabeledImageIds()
    : new Set<string>();
  const scopedEntries =
    scope === "review"
      ? reviewQueue(manifest.entries, REVIEW_HOLDOUT_COUNT)
      : manifest.entries.filter((entry) => entry.captureStatus === "ready");
  const entries = scopedEntries.filter(
    (entry) =>
      (selectedSplit === "all" || entry.split === selectedSplit) &&
      (!unlabeledOnly || !labeledImageIds.has(entry.id)),
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
  console.log(`Model: ${model}`);
  const client = createOpenAIClient({
    model,
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
      if (paceMs > 0 && completed > 0)
        await new Promise((resolve) => setTimeout(resolve, paceMs));
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

      const response = await chatWithRetry(client, {
        system: systemPrompt,
        user: `${brandContext(chunk[0], prompt)}${classifyInstruction(prompt, chunk.length, ids)}`,
        images: images.filter((url): url is string => Boolean(url)),
        imageDetail: "low",
        json: true,
        schema: classificationSchema(keptTags, prompt),
        maxTokens: 250 * chunk.length,
        temperature: 0,
        // No-op on non-reasoning models; keeps the luna arm matching production intent.
        reasoningEffort: "none",
        meta: {
          imageIds: chunk.map((entry) => entry.id),
          split: selectedSplit,
          scope,
          unlabeledOnly,
          paceMs,
          prompt,
          tagRegistry: tagDefinitions,
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
        if (!response.ok || !raw || (prompt === "legacy" && !tag)) {
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
        const mapped =
          prompt === "current"
            ? currentPrediction(raw, new Set(keptTags))
            : tagFromLegacyTag(tag ?? "", new Set(keptTags));
        predictions.push({
          imageId: entry.id,
          disposition: mapped.disposition,
          tag: mapped.tag,
          reasons:
            prompt === "current" && mapped.disposition === "reject"
              ? parsedRejectionReasons(raw?.reasons, tag)
              : mapped.disposition === "reject"
                ? rejectionReasons(tag ?? "")
                : [],
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
    model,
    split: selectedSplit,
    scope,
    unlabeledOnly,
    paceMs,
    reviewQueueSeed: scope === "review" ? REVIEW_QUEUE_SEED : null,
    prompt,
    tagDefinitions,
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
