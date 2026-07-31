import { readdir } from "node:fs/promises";
import {
  BASELINE_PATH,
  LABELS_PATH,
  MANIFEST_PATH,
  RUN_ROOT,
  ensureEvalDirectories,
  readJson,
  runPath,
  writeJsonAtomic,
} from "./lib/paths";
import { validateLabelsForManifest } from "./lib/labels";
import { scorePredictions } from "./lib/scoring";
import type {
  EvalPrediction,
  GoldenLabelsFile,
  GoldenManifest,
  GoldenSplit,
} from "./lib/types";

type PredictionFile = {
  corpusId: string;
  predictions: EvalPrediction[];
  split: GoldenSplit | "all";
};

function splitArg(): GoldenSplit | "all" {
  const argument = process.argv.find((value) => value.startsWith("--split="));
  const value = argument?.slice("--split=".length) ?? "dev";
  if (value !== "dev" && value !== "holdout" && value !== "all")
    throw new Error("--split must be dev, holdout, or all");
  return value;
}

async function latestPredictionPath(): Promise<string> {
  const runId = process.argv
    .find((value) => value.startsWith("--run="))
    ?.slice("--run=".length);
  if (runId) return runPath(runId, "predictions.json");
  const directories = (await readdir(RUN_ROOT, { withFileTypes: true }))
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("baseline-"),
    )
    .map((entry) => entry.name)
    .sort();
  const latest = directories.at(-1);
  if (!latest)
    throw new Error(
      "No baseline run found; run `pnpm image-eval:baseline` first",
    );
  return runPath(latest, "predictions.json");
}

async function score(): Promise<void> {
  await ensureEvalDirectories();
  const manifest = await readJson<GoldenManifest>(MANIFEST_PATH);
  const labels = await readJson<GoldenLabelsFile>(LABELS_PATH);
  const split = splitArg();
  const validationErrors = validateLabelsForManifest(
    manifest,
    labels,
    split === "all" ? undefined : split,
  );
  if (validationErrors.length > 0)
    throw new Error(
      `Label validation failed:\n${validationErrors.slice(0, 20).join("\n")}`,
    );

  const predictionPath = await latestPredictionPath();
  const predictionFile = await readJson<PredictionFile>(predictionPath);
  if (predictionFile.corpusId !== manifest.corpusId)
    throw new Error("prediction corpusId does not match manifest");
  const splits: GoldenSplit[] = split === "all" ? ["dev", "holdout"] : [split];
  const scores = splits.map((currentSplit) =>
    scorePredictions(
      manifest,
      labels.labels,
      predictionFile.predictions,
      currentSplit,
    ),
  );
  const output = {
    corpusId: manifest.corpusId,
    predictionPath,
    generatedAt: new Date().toISOString(),
    scores,
  };
  await writeJsonAtomic(
    runPath(predictionPath.split("/").at(-2) ?? "unknown", "score.json"),
    output,
  );
  if (split === "dev") await writeJsonAtomic(BASELINE_PATH, output);
  console.log(JSON.stringify(output, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void score().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
