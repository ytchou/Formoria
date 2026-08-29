/**
 * Seed Langfuse with the 10 prompt constants from src/lib/prompts/*.
 *
 * Vocab blocks (CATEGORY_LIST, SUBCATEGORY_VOCAB_BLOCK, MATERIAL_VOCAB_BLOCK,
 * TAIWAN_USAGE_RULES) are replaced with {{mustache}} placeholders so prompts
 * stay in sync with the taxonomy ontology at deploy time.
 *
 * Usage:
 *   pnpm langfuse:seed          # create/update prompts on Langfuse
 *   pnpm langfuse:seed --dry    # print actions without executing
 */

import { createHash } from "node:crypto";
import { Langfuse } from "langfuse";

import { DETECT_SYSTEM_PROMPT, CLASSIFY_SYSTEM_PROMPT } from "@/lib/prompts/detect";
import { FACTS_SYSTEM_PROMPT } from "@/lib/prompts/facts";
import { NAME_ARBITER_SYSTEM_PROMPT } from "@/lib/prompts/names";
import { SITE_IDENTITY_SYSTEM_PROMPT } from "@/lib/prompts/site-identity";
import { DESCRIPTION_SYSTEM_PROMPT } from "@/lib/prompts/descriptions";
import { REPUTATION_SYSTEM_PROMPT } from "@/lib/prompts/reputation";
import { FAQ_PROMPT_PREAMBLE } from "@/lib/prompts/faq";
import { IMAGE_CLASSIFY_SYSTEM_PROMPT } from "@/lib/prompts/classify-images";
import { PRODUCTS_SYSTEM_PROMPT } from "@/lib/prompts/products";
import {
  CATEGORY_LIST,
  SUBCATEGORY_VOCAB_BLOCK,
  MATERIAL_VOCAB_BLOCK,
  TAIWAN_USAGE_RULES,
} from "@/lib/prompts/shared";

// ---------------------------------------------------------------------------
// Variable definitions
// ---------------------------------------------------------------------------

const VARIABLE_MAP: Record<string, string> = {
  category_list: CATEGORY_LIST,
  subcategory_vocab_block: SUBCATEGORY_VOCAB_BLOCK,
  material_vocab_block: MATERIAL_VOCAB_BLOCK,
  taiwan_usage_rules: TAIWAN_USAGE_RULES,
};

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

interface PromptEntry {
  name: string;
  prompt: string;
  variables: Record<string, string>;
}

/**
 * Replace each variable value with its {{placeholder}} in the prompt text.
 * Asserts the placeholder appears exactly once and the original value is gone.
 */
function templatize(
  raw: string,
  variables: Record<string, string>,
): string {
  let result = raw;
  for (const [varName, value] of Object.entries(variables)) {
    const placeholder = `{{${varName}}}`;

    // If the prompt already contains the {{placeholder}} (e.g. it was authored
    // with mustache syntax rather than JS interpolation), skip this variable.
    if (result.includes(placeholder)) {
      console.warn(
        `  WARN  Variable "${varName}" already present as {{${varName}}} — skipping templatize for this variable.`,
      );
      continue;
    }

    const count = result.split(value).length - 1;
    if (count === 0) {
      throw new Error(
        `Variable "${varName}" value not found in prompt. ` +
          `Expected to find the vocab block but it was absent.`,
      );
    }
    if (count > 1) {
      throw new Error(
        `Variable "${varName}" value appears ${count} times in prompt — expected exactly 1.`,
      );
    }
    result = result.replace(value, placeholder);
  }
  return result;
}

function assertReplacedOnce(template: string, variables: Record<string, string>): void {
  for (const [varName, value] of Object.entries(variables)) {
    const placeholder = `{{${varName}}}`;
    const placeholderCount = template.split(placeholder).length - 1;
    if (placeholderCount !== 1) {
      throw new Error(
        `Assertion failed: placeholder {{${varName}}} appears ${placeholderCount} times (expected 1).`,
      );
    }
    if (template.includes(value)) {
      throw new Error(
        `Assertion failed: original value for "${varName}" still present after replacement.`,
      );
    }
  }
}

function buildManifest(): PromptEntry[] {
  const entries: Array<{
    name: string;
    prompt: string;
    variableNames: string[];
  }> = [
    { name: "detect", prompt: DETECT_SYSTEM_PROMPT, variableNames: [] },
    { name: "category-classify", prompt: CLASSIFY_SYSTEM_PROMPT, variableNames: ["category_list"] },
    {
      name: "brand-facts",
      prompt: FACTS_SYSTEM_PROMPT,
      variableNames: ["category_list", "subcategory_vocab_block", "material_vocab_block"],
    },
    { name: "name-arbiter", prompt: NAME_ARBITER_SYSTEM_PROMPT, variableNames: [] },
    { name: "site-identity", prompt: SITE_IDENTITY_SYSTEM_PROMPT, variableNames: [] },
    { name: "descriptions", prompt: DESCRIPTION_SYSTEM_PROMPT, variableNames: ["taiwan_usage_rules"] },
    { name: "reputation", prompt: REPUTATION_SYSTEM_PROMPT, variableNames: [] },
    { name: "faq-preamble", prompt: FAQ_PROMPT_PREAMBLE, variableNames: ["taiwan_usage_rules"] },
    { name: "classify-images", prompt: IMAGE_CLASSIFY_SYSTEM_PROMPT, variableNames: [] },
    {
      name: "products",
      prompt: PRODUCTS_SYSTEM_PROMPT,
      variableNames: ["category_list", "subcategory_vocab_block", "material_vocab_block", "taiwan_usage_rules"],
    },
  ];

  return entries.map(({ name, prompt, variableNames }) => {
    const variables: Record<string, string> = {};
    for (const vn of variableNames) {
      variables[vn] = VARIABLE_MAP[vn];
    }
    return { name, prompt, variables };
  });
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");

  const manifest = buildManifest();
  console.log(`Manifest: ${manifest.length} prompts`);

  // Templatize and validate
  const prepared = manifest.map((entry) => {
    const hasVars = Object.keys(entry.variables).length > 0;
    const template = hasVars ? templatize(entry.prompt, entry.variables) : entry.prompt;
    if (hasVars) {
      assertReplacedOnce(template, entry.variables);
    }
    return { ...entry, template };
  });

  if (dry) {
    console.log("\n--dry mode: no Langfuse calls will be made.\n");
    for (const p of prepared) {
      const hash = contentHash(p.template);
      const vars = Object.keys(p.variables);
      console.log(
        `  ${p.name}  hash=${hash.slice(0, 12)}…  vars=[${vars.join(", ")}]`,
      );
    }
    console.log("\nDone (dry run).");
    return;
  }

  // Initialize Langfuse directly (not via getLangfuse — the singleton swallows
  // errors, but this script needs them loud).
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const baseUrl = process.env.LANGFUSE_HOST;

  if (!publicKey || !secretKey || !baseUrl) {
    console.error(
      "Missing LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, or LANGFUSE_HOST. " +
        "Set them in .env.local or export them.",
    );
    process.exitCode = 1;
    return;
  }

  const langfuse = new Langfuse({ publicKey, secretKey, baseUrl });

  let created = 0;
  let skipped = 0;

  for (const p of prepared) {
    const newHash = contentHash(p.template);

    // Check if the prompt already exists with the same content
    let existing: { prompt: string } | null = null;
    try {
      const result = await langfuse.api.promptsGet({
        promptName: p.name,
        label: "production",
      });
      if (result.type === "text") {
        existing = { prompt: (result as { prompt: string }).prompt };
      }
    } catch {
      // Prompt does not exist yet — that's fine
    }

    if (existing && contentHash(existing.prompt) === newHash) {
      console.log(`  SKIP  ${p.name}  (content unchanged)`);
      skipped++;
      continue;
    }

    const action = existing ? "UPDATE" : "CREATE";
    console.log(`  ${action}  ${p.name}`);

    await langfuse.api.promptsCreate({
      name: p.name,
      prompt: p.template,
      type: "text",
      labels: ["production"],
    });
    created++;
  }

  await langfuse.flushAsync();
  await langfuse.shutdownAsync();

  console.log(`\nDone. Created/updated: ${created}, skipped: ${skipped}.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
