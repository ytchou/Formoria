export async function cmdAgreement(
  values: Record<string, unknown>,
): Promise<void> {
  if (values.help) {
    console.log(
      "Usage: pnpm search:eval agreement [--human hand-labels.json] [--llm llm-labels.json]",
    );
    console.log(
      "  Computes Cohen's kappa between LLM grades and hand-labeled pairs",
    );
    return;
  }
  console.log("[agreement] Placeholder — requires hand-labeled data");
}
