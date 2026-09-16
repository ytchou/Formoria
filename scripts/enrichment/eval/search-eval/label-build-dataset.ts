export async function cmdBuildDataset(
  values: Record<string, unknown>,
): Promise<void> {
  if (values.help) {
    console.log("Usage: pnpm search:eval build-dataset [--split 60/20/20]");
    console.log(
      "  Reads all labels, splits queries into train/val/holdout, uploads to Langfuse as situation-search-v2",
    );
    return;
  }
  console.log("[build-dataset] Placeholder — requires labeled data");
}
