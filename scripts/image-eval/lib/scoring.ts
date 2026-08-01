import type {
  EvalPrediction,
  EvalScore,
  GoldenLabel,
  GoldenManifest,
  GoldenSplit,
  KeptTag,
} from "./types";

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(6));
}

export function scorePredictions(
  manifest: GoldenManifest,
  labels: Record<string, GoldenLabel>,
  predictions: readonly EvalPrediction[],
  split: GoldenSplit,
): EvalScore {
  const predictionById = new Map(
    predictions.map((prediction) => [prediction.imageId, prediction]),
  );
  const entries = manifest.entries.filter(
    (entry) => entry.captureStatus === "ready" && entry.split === split,
  );
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let keptTagCorrect = 0;
  let keptTagTotal = 0;
  let acceptedWrongBrand = 0;
  let acceptedTimeSensitive = 0;
  const confusion = {
    keepKeep: 0,
    keepReject: 0,
    rejectKeep: 0,
    rejectReject: 0,
  };

  for (const entry of entries) {
    const label = labels[entry.id];
    const prediction = predictionById.get(entry.id);
    if (!label || !prediction) continue;

    const actualKeep = label.disposition === "keep";
    const predictedKeep = prediction.disposition === "keep";
    if (actualKeep && predictedKeep) {
      truePositive += 1;
      confusion.keepKeep += 1;
    } else if (!actualKeep && predictedKeep) {
      falsePositive += 1;
      confusion.rejectKeep += 1;
      if (label.reasons.includes("wrong_brand")) acceptedWrongBrand += 1;
      if (label.reasons.includes("time_sensitive")) acceptedTimeSensitive += 1;
    } else if (actualKeep) {
      falseNegative += 1;
      confusion.keepReject += 1;
    } else {
      confusion.rejectReject += 1;
    }

    if (actualKeep && predictedKeep) {
      keptTagTotal += 1;
      if (prediction.tag === label.tag) keptTagCorrect += 1;
    }
  }

  const labeledCount = Object.keys(labels).filter((imageId) =>
    entries.some((entry) => entry.id === imageId),
  ).length;

  return {
    corpusId: manifest.corpusId,
    split,
    labeledCount,
    keepTruePositive: truePositive,
    keepFalsePositive: falsePositive,
    keepFalseNegative: falseNegative,
    keepPrecision: ratio(truePositive, truePositive + falsePositive),
    keepRecall: ratio(truePositive, truePositive + falseNegative),
    keptTagAccuracy: ratio(keptTagCorrect, keptTagTotal),
    acceptedWrongBrand,
    acceptedTimeSensitive,
    confusion,
  };
}

export function tagFromLegacyTag(tag: string): {
  disposition: "keep" | "reject";
  tag: KeptTag | null;
} {
  if (
    tag === "product" ||
    tag === "lifestyle" ||
    tag === "packaging" ||
    tag === "logo"
  ) {
    return { disposition: "keep", tag };
  }
  return { disposition: "reject", tag: null };
}
