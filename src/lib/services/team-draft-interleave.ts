// ---------------------------------------------------------------------------
// Team-Draft Interleaving
// ---------------------------------------------------------------------------
//
// Deterministic interleaving of two ranked lists (RRF and LTR) using the
// Team-Draft algorithm: at each position the team with fewer members in the
// merged list picks first; ties are broken by a seeded PRNG coin flip.
// ---------------------------------------------------------------------------

/**
 * Hash a seed string to a 32-bit unsigned integer.
 * Sum char codes, multiply by Knuth's golden-ratio prime.
 */
function hashSeed(seed: string): number {
  let sum = 0;
  for (let i = 0; i < seed.length; i++) {
    sum += seed.charCodeAt(i);
  }
  return Math.imul(sum, 2654435761) >>> 0;
}

/**
 * mulberry32 — deterministic 32-bit PRNG.
 * Returns a function that produces values in [0, 1).
 */
function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick the first item from `order` that is not already in `used`. */
function pickNext(order: readonly string[], used: Set<string>): string | null {
  for (const item of order) {
    if (!used.has(item)) return item;
  }
  return null;
}

export function teamDraftInterleave(
  rrfOrder: string[],
  ltrOrder: string[],
  seed: string,
): { merged: string[]; armBySlot: ("rrf" | "ltr")[] } {
  const union = new Set([...rrfOrder, ...ltrOrder]);
  const n = union.size;
  if (n === 0) return { merged: [], armBySlot: [] };

  const prng = mulberry32(hashSeed(seed));
  const merged: string[] = [];
  const armBySlot: ("rrf" | "ltr")[] = [];
  const used = new Set<string>();
  let rrfPicked = 0;
  let ltrPicked = 0;

  for (let i = 0; i < n; i++) {
    let team: "rrf" | "ltr";
    if (rrfPicked < ltrPicked) {
      team = "rrf";
    } else if (ltrPicked < rrfPicked) {
      team = "ltr";
    } else {
      team = prng() < 0.5 ? "rrf" : "ltr";
    }

    const list = team === "rrf" ? rrfOrder : ltrOrder;
    let item = pickNext(list, used);

    if (item === null) {
      // Designated team exhausted — switch to other team
      team = team === "rrf" ? "ltr" : "rrf";
      const otherList = team === "rrf" ? rrfOrder : ltrOrder;
      item = pickNext(otherList, used);
    }

    if (item === null) break; // both exhausted (shouldn't happen)

    merged.push(item);
    used.add(item);
    armBySlot.push(team);
    if (team === "rrf") rrfPicked++;
    else ltrPicked++;
  }

  return { merged, armBySlot };
}
