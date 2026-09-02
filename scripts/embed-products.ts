/**
 * @formoria-script
 * purpose: Backfill product embeddings for situation search.
 * class: operator
 * invoke: pnpm embeddings:backfill
 * target: staging-default
 * safety: dry-run-default
 * owner: engineering
 */
/**
 * Operator script: compute and store embeddings for all product embedding
 * documents whose source hash is missing or stale.
 *
 * Usage:
 *   pnpm embeddings:backfill                        # dry run, default limit
 *   pnpm embeddings:backfill --apply                # embed up to 2000
 *   pnpm embeddings:backfill --apply --all          # embed everything
 *   pnpm embeddings:backfill --apply --limit 500    # embed up to 500
 */
import { loadScriptTarget } from "./shared/target";
import { refreshProductEmbeddings } from "@/lib/services/product-embeddings";

type ParsedArgs = {
  all: boolean;
  limit: number;
  dryRun: boolean;
};

export function parseArgs(argv: string[]): ParsedArgs {
  let all = false;
  let limit = 2000;
  let dryRun = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--all") {
      all = true;
    } else if (arg === "--limit") {
      const next = argv[i + 1];
      if (!next || Number.isNaN(Number(next))) {
        throw new Error("--limit requires a numeric argument");
      }
      limit = Number(next);
      i += 1;
    } else if (arg === "--apply") {
      dryRun = false;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--target" || arg.startsWith("--target=")) {
      // Handled by loadScriptTarget; skip.
      if (arg === "--target") i += 1;
    } else {
      throw new Error(`Unknown flag: ${arg}`);
    }
  }

  return { all, limit, dryRun };
}

async function main(): Promise<void> {
  const { argv } = loadScriptTarget();
  const args = parseArgs(argv);

  const effectiveLimit = args.all ? Number.MAX_SAFE_INTEGER : args.limit;

  console.log(
    `[embed-products] mode: ${args.dryRun ? "DRY RUN (pass --apply)" : "APPLY"}  limit: ${args.all ? "all" : args.limit}`,
  );

  const result = await refreshProductEmbeddings({
    limit: effectiveLimit,
    dryRun: args.dryRun,
  });

  console.log(
    `[embed-products] stale: ${result.stale}  embedded: ${result.embedded}  deleted: ${result.deleted}  failed: ${result.failedBatches.length}`,
  );

  if (result.failedBatches.length > 0) {
    for (const batch of result.failedBatches) {
      console.error(`[embed-products] FAILED: ${batch}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
