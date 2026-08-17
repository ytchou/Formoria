import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { DESCRIPTION_SYSTEM_PROMPT } from "../src/lib/prompts";
import {
  createDeepSeekClient,
  parseDeepSeekJson,
} from "../src/lib/services/deepseek-client";
import { localizeToTW } from "../src/lib/services/taiwan-localization";
import {
  createOpenAIClient,
  parseJson,
} from "../src/lib/services/openai-client";

const MAX_BRANDS = 3;
const MAX_TOKENS = 4500;
const TIMEOUT_MS = 30_000;

type AiResultRow = {
  brand_id: string;
  input: unknown;
  created_at: string;
};

type BrandRow = {
  id: string;
  name: string | null;
};

type DescriptionInput = {
  brandName?: unknown;
  existingDescription?: unknown;
  snippets?: unknown;
  siteContent?: unknown;
};

type ChineseOutput = {
  description: string | null;
  blurb: string | null;
};

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createSupabaseClient(url, serviceRoleKey);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function buildUserContent(
  input: DescriptionInput,
  fallbackBrandName: string,
): string {
  const brandName = stringValue(input.brandName) ?? fallbackBrandName;
  const existingDescription = stringValue(input.existingDescription);
  const snippets = Array.isArray(input.snippets)
    ? input.snippets.filter(
        (snippet): snippet is string => typeof snippet === "string",
      )
    : [];
  const siteContent = stringValue(input.siteContent);

  return [
    `品牌名稱：${brandName}`,
    existingDescription ? `現有描述：${existingDescription}` : "",
    snippets.length > 0 ? `搜尋摘要：\n${snippets.join("\n")}` : "",
    siteContent ? `網站內容：\n${siteContent}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function extractChineseOutput(
  content: string | null,
  parser: (value: string) => unknown,
): ChineseOutput {
  if (!content) return { description: null, blurb: null };

  const parsed = parser(content);
  if (!parsed || typeof parsed !== "object")
    return { description: null, blurb: null };

  const result = parsed as Record<string, unknown>;
  return {
    description: stringValue(result.description_zh ?? result.description),
    blurb: stringValue(result.blurb_zh),
  };
}

function logModelCall(
  model: string,
  user: string,
  result: { response: Response; data: unknown; content: string | null },
  latencyMs: number,
): void {
  console.log(
    JSON.stringify({
      event: "enrichment.model_comparison_call",
      model,
      request: { system: DESCRIPTION_SYSTEM_PROMPT, user },
      response: { status: result.response.status, payload: result.data },
      latencyMs,
    }),
  );
}

async function runDeepSeek(user: string) {
  const startAt = Date.now();
  const result = await createDeepSeekClient({
    model: "deepseek-v4-flash",
  }).chat({
    system: DESCRIPTION_SYSTEM_PROMPT,
    user,
    json: true,
    timeoutMs: TIMEOUT_MS,
    maxTokens: MAX_TOKENS,
    temperature: 0.1,
  });
  logModelCall("deepseek-v4-flash", user, result, Date.now() - startAt);
  return result;
}

async function runOpenAI(user: string) {
  const startAt = Date.now();
  const result = await createOpenAIClient({ model: "gpt-4o-mini" }).chat({
    system: DESCRIPTION_SYSTEM_PROMPT,
    user,
    json: true,
    timeoutMs: TIMEOUT_MS,
    maxTokens: MAX_TOKENS,
    temperature: 0.1,
  });
  logModelCall("gpt-4o-mini", user, result, Date.now() - startAt);
  return result;
}

async function loadInputs(supabase: ReturnType<typeof createServiceClient>) {
  const { data: aiRows, error: aiError } = await supabase
    .from("brand_ai_results")
    .select("brand_id, input, created_at")
    .eq("phase", "description")
    .not("input", "is", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (aiError) throw aiError;

  const latestByBrand = new Map<string, AiResultRow>();
  for (const row of (aiRows ?? []) as AiResultRow[]) {
    if (!latestByBrand.has(row.brand_id)) latestByBrand.set(row.brand_id, row);
  }

  const selectedRows = [...latestByBrand.values()].slice(0, MAX_BRANDS);
  const brandIds = selectedRows.map((row) => row.brand_id);
  if (brandIds.length === 0) return [];

  const { data: brands, error: brandError } = await supabase
    .from("brands")
    .select("id, name")
    .in("id", brandIds);

  if (brandError) throw brandError;

  const brandNames = new Map(
    ((brands as BrandRow[] | null) ?? []).map((brand) => [
      brand.id,
      brand.name,
    ]),
  );
  return selectedRows.map((row) => ({
    brandId: row.brand_id,
    brandName: brandNames.get(row.brand_id) ?? row.brand_id,
    input: row.input,
  }));
}

async function main(): Promise<void> {
  const supabase = createServiceClient();
  const inputs = await loadInputs(supabase);

  if (inputs.length === 0) {
    console.log("No audited description inputs found.");
    return;
  }

  for (const item of inputs) {
    const input =
      item.input && typeof item.input === "object"
        ? (item.input as DescriptionInput)
        : {};
    const user = buildUserContent(input, item.brandName);
    const [deepSeek, openAi] = await Promise.all([
      runDeepSeek(user),
      runOpenAI(user),
    ]);
    const deepSeekOutput = extractChineseOutput(
      deepSeek.content,
      parseDeepSeekJson,
    );
    const openAiOutput = extractChineseOutput(openAi.content, parseJson);

    console.log(`\n=== ${item.brandName} (${item.brandId}) ===`);
    console.log(
      JSON.stringify(
        {
          deepseek: {
            raw: deepSeekOutput,
            localized: {
              description: deepSeekOutput.description
                ? localizeToTW(deepSeekOutput.description, {
                    brandName: item.brandName,
                  }).text
                : null,
              blurb: deepSeekOutput.blurb
                ? localizeToTW(deepSeekOutput.blurb, {
                    brandName: item.brandName,
                  }).text
                : null,
            },
          },
          "gpt-4o-mini": {
            raw: openAiOutput,
            localized: {
              description: openAiOutput.description
                ? localizeToTW(openAiOutput.description, {
                    brandName: item.brandName,
                  }).text
                : null,
              blurb: openAiOutput.blurb
                ? localizeToTW(openAiOutput.blurb, {
                    brandName: item.brandName,
                  }).text
                : null,
            },
          },
        },
        null,
        2,
      ),
    );
  }
}

if (process.argv[1]?.endsWith("compare-models-tw.ts")) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
