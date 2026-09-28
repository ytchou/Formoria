/**
 * DEV-1896 D3/D10: score the name production would ship, not the raw pick.
 *
 * `shippedName` runs a verdict through the production acceptance gate
 * (`resolveArbitratedName`), so a low-confidence rename scores as the fallback
 * it would become. `shippedNameSweep` tunes the Jev names band cutoffs offline
 * against that shipped name.
 *
 * Pure. Must not import the Jev question builders: this module is imported by the eval
 * adapters and the llm-eval CLI, and the `jev-eval-only` allowlist stays as is.
 */
import { resolveArbitratedName } from "@/lib/services/enrich-phases/names";
import {
  parseNameArbiterItemLine,
  type ParsedNameArbiterItem,
} from "@/lib/services/name-arbiter";

type ConfidenceBand = "high" | "medium" | "low";

export type ShippedNameVerdict = {
  /** Null when the arm made no pick (a Jev names answer can be empty). */
  chosen: string | null;
  confidence: ConfidenceBand;
};

/**
 * The name production would write for this verdict. `user` is the rendered
 * single-item name-arbiter user message; its candidates are already normalized
 * (the golden inputs are rendered by the production formatter).
 */
export function shippedName(user: string, verdict: ShippedNameVerdict): string {
  const parsed = user
    .split("\n")
    .map((line) => parseNameArbiterItemLine(line))
    .filter((item): item is ParsedNameArbiterItem => item !== null);
  if (parsed.length !== 1) {
    throw new Error(
      `shippedName expects exactly one name-arbiter item line, found ${parsed.length}`,
    );
  }
  const item = parsed[0]!;
  return resolveArbitratedName(
    verdict.chosen === null
      ? undefined
      : { chosen: verdict.chosen, confidence: verdict.confidence, reason: "" },
    item.candidates,
    item.storedName,
  );
}

export type ShippedSweepPoint = {
  user: string;
  chosen: string | null;
  probability: number;
  acceptedNames: string[];
};

export type ShippedSweepRow = {
  high: number;
  medium: number;
  agreed: number;
  total: number;
  agreement: number;
};

export type ShippedSweepResult = {
  rows: ShippedSweepRow[];
  best: { high: number; medium: number; agreement: number };
};

/** D10 grid: 0.50..0.95 in 0.05 steps, built from integers to avoid float drift. */
export const NAMES_CUTOFF_GRID: readonly number[] = Array.from(
  { length: 10 },
  (_, i) => (50 + i * 5) / 100,
);

function bandAt(probability: number, high: number, medium: number): ConfidenceBand {
  if (probability >= high) return "high";
  if (probability >= medium) return "medium";
  return "low";
}

/**
 * Shipped-name agreement for every (medium < high) cutoff pair of `grid`.
 * `best` maximises agreement; a tie goes to the higher high cutoff, then the
 * higher medium cutoff (compared on integer counts, so ties are exact).
 */
export function shippedNameSweep(
  points: readonly ShippedSweepPoint[],
  grid: readonly number[] = NAMES_CUTOFF_GRID,
): ShippedSweepResult {
  if (points.length === 0) throw new Error("shippedNameSweep needs at least one point");
  const cutoffs = [...grid].sort((a, b) => b - a);
  const rows: ShippedSweepRow[] = [];
  let best: ShippedSweepRow | undefined;

  for (const high of cutoffs) {
    for (const medium of cutoffs) {
      if (medium >= high) continue;
      const agreed = points.filter((point) =>
        point.acceptedNames.includes(
          shippedName(point.user, {
            chosen: point.chosen,
            confidence: bandAt(point.probability, high, medium),
          }),
        ),
      ).length;
      const row = { high, medium, agreed, total: points.length, agreement: agreed / points.length };
      rows.push(row);
      // Iteration runs high-then-medium descending, so strict > keeps the tie-break.
      if (!best || row.agreed > best.agreed) best = row;
    }
  }

  if (!best) throw new Error("shippedNameSweep grid has no medium < high pair");
  return { rows, best: { high: best.high, medium: best.medium, agreement: best.agreement } };
}
