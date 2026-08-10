/**
 * This guard proves only the migration seed floor, not live price-table state.
 * Runtime-overridden models (OPENAI_MODEL_OVERRIDE, caller options.model, and
 * free-form input.model) are beyond static reach; runtime pricingCoverage is
 * the backstop for those paths.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LLM_MODELS } from "@/lib/constants/llm-models";

const DORMANT_MODELS = new Set([
  "deepseek-v4-flash", // Registry-only dormant provider; no production calls or seeded price.
]);

function seededModels(): Set<string> {
  const migrations = join(process.cwd(), "supabase", "migrations");
  const sql = readdirSync(migrations)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => readFileSync(join(migrations, file), "utf8"))
    .join("\n");
  const inserts =
    sql.match(/insert into llm_model_prices[\s\S]*?on conflict/gi) ?? [];
  return new Set(
    [
      ...inserts
        .join("\n")
        .matchAll(/'([^']+)'\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+/g),
    ]
      .map((match) => match[1])
      .filter((model): model is string => Boolean(model)),
  );
}

function modelsWithoutSeed(
  models: readonly string[],
  seeded: ReadonlySet<string>,
): string[] {
  return [...new Set(models)].filter(
    (model) => !DORMANT_MODELS.has(model) && !seeded.has(model),
  );
}

describe("LLM price migration coverage", () => {
  it("every active model has a seeded price row", () => {
    expect(
      modelsWithoutSeed(Object.values(LLM_MODELS), seededModels()),
    ).toEqual([]);
  });

  it("fails when a model has no seeded price", () => {
    expect(modelsWithoutSeed(["gpt-future-unpriced"], seededModels())).toEqual([
      "gpt-future-unpriced",
    ]);
  });
});
