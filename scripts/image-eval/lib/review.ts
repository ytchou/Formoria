import { stableNumber } from "./hash";
import type { GoldenImageEntry } from "./types";

export const REVIEW_QUEUE_SEED = "dev-1279-review-order-v1";
export const REVIEW_HOLDOUT_COUNT = 50;

function randomized(
  entries: readonly GoldenImageEntry[],
  partition: "dev" | "holdout",
): GoldenImageEntry[] {
  return [...entries].toSorted((left, right) => {
    const difference =
      stableNumber(`${REVIEW_QUEUE_SEED}:${partition}:${left.id}`) -
      stableNumber(`${REVIEW_QUEUE_SEED}:${partition}:${right.id}`);
    return difference || left.id.localeCompare(right.id);
  });
}

export function reviewQueue(
  entries: readonly GoldenImageEntry[],
  holdoutCount = REVIEW_HOLDOUT_COUNT,
): GoldenImageEntry[] {
  const ready = entries.filter(
    (entry) => entry.captureStatus === "ready" && entry.objectPath,
  );
  const dev = randomized(
    ready.filter((entry) => entry.split === "dev"),
    "dev",
  );
  const holdout = randomized(
    ready.filter((entry) => entry.split === "holdout"),
    "holdout",
  );
  if (holdout.length < holdoutCount) {
    throw new Error(
      `Review queue needs ${holdoutCount} holdout images; found ${holdout.length}`,
    );
  }
  return [...dev, ...holdout.slice(0, holdoutCount)];
}
