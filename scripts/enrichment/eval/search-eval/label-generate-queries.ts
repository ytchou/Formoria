export async function cmdGenerateQueries(
  values: Record<string, unknown>,
): Promise<void> {
  if (values.help) {
    console.log(
      "Usage: pnpm search:eval generate-queries [--count 100]",
    );
    console.log(
      "  Generates zh-TW situation query candidates from taxonomy + product descriptions",
    );
    return;
  }
  console.log(
    "[generate-queries] Placeholder — run against staging to generate query candidates",
  );
}
