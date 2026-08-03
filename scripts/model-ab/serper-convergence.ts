/**
 * Does repeating a serper /search query buy anything?
 *
 *   pnpm exec tsx --env-file=.env.local scripts/model-ab/serper-convergence.ts
 *
 * Repeats each query N times and reports how the union grows and how often each
 * URL recurs. The shape of that curve decides the strategy:
 *
 *   - union plateaus fast  -> churn is ranking noise over a stable pool, so
 *                             K runs + a "seen in >= 2" filter is both more
 *                             complete and more reproducible than one run.
 *   - union keeps growing  -> the result set is genuinely unbounded and no
 *                             affordable number of repeats stabilises it;
 *                             cache one run instead and accept it.
 */
const QUERIES = [
  "Entadar 海漂計畫",
  "Yates 亞堤斯",
  "日句時刻所 Heyyou Moment",
];
const REPEATS = 5;

async function search(
  q: string,
): Promise<{ links: string[]; snippets: number }> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": process.env.SERPER_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q,
      num: 10,
      gl: "tw",
      hl: "zh-TW",
      autocorrect: false,
    }),
  });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const json = (await res.json()) as {
    organic?: Array<{ link: string; snippet?: string }>;
  };
  const organic = json.organic ?? [];
  return {
    links: organic.map((o) => o.link),
    snippets: organic.filter((o) => (o.snippet ?? "").length > 0).length,
  };
}

async function main(): Promise<void> {
  for (const q of QUERIES) {
    const runs: string[][] = [];
    let snippetTotal = 0;
    for (let i = 0; i < REPEATS; i++) {
      const r = await search(q);
      runs.push(r.links);
      snippetTotal += r.snippets;
    }

    const union = new Set<string>();
    const growth: number[] = [];
    for (const r of runs) {
      for (const l of r) union.add(l);
      growth.push(union.size);
    }

    const freq = new Map<string, number>();
    for (const r of runs)
      for (const l of new Set(r)) freq.set(l, (freq.get(l) ?? 0) + 1);
    const core = [...freq.values()].filter((v) => v === REPEATS).length;
    const twoPlus = [...freq.values()].filter((v) => v >= 2).length;
    const once = [...freq.values()].filter((v) => v === 1).length;

    console.log(`\n${q}`);
    console.log(`  per-run sizes    : ${runs.map((r) => r.length).join(", ")}`);
    console.log(`  union after 1..${REPEATS}: ${growth.join(" -> ")}`);
    console.log(`  in all ${REPEATS} runs   : ${core}`);
    console.log(`  in >= 2 runs     : ${twoPlus}`);
    console.log(
      `  in exactly 1 run : ${once}  (${((once / union.size) * 100).toFixed(0)}% of union is one-off noise)`,
    );
    console.log(`  snippets/run avg : ${(snippetTotal / REPEATS).toFixed(1)}`);
  }
}

void main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});

export {};
