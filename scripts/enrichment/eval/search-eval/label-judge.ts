export async function cmdJudge(
  values: Record<string, unknown>,
): Promise<void> {
  if (values.help) {
    console.log(
      "Usage: pnpm search:eval judge [--model gpt-4o-mini] [--input query-candidates.json]",
    );
    console.log(
      "  Runs LLM judge (single-shot) on (query, product) pairs, outputs 0-3 grade + confidence",
    );
    return;
  }
  console.log("[judge] Placeholder — run against staging with OPENAI_API_KEY");
}

export async function cmdRetrieveCandidates(
  values: Record<string, unknown>,
): Promise<void> {
  if (values.help) {
    console.log(
      "Usage: pnpm search:eval retrieve-candidates [--mode hybrid] [--pageSize 100]",
    );
    console.log(
      "  For each query, call searchProductsBySituation and write candidate pairs",
    );
    return;
  }
  console.log("[retrieve-candidates] Placeholder — run against staging");
}
