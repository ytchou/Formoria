import {
  EMBEDDING_BATCH_SIZE,
  EMBEDDING_MODEL,
} from "@/lib/constants/llm-models";
import { createAuditedEmbeddingsClient } from "./embeddings-audit";
import type { EmbeddingsResult } from "./openai-embeddings-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DocumentRow = {
  product_id: string;
  source_hash: string;
  content: string;
};

type ExistingRow = {
  product_id: string;
  source_hash: string;
};

type UpsertRow = {
  product_id: string;
  embedding: string;
  model: string;
  source_hash: string;
};

type EmbeddingPlan = {
  stale: DocumentRow[];
  orphanIds: string[];
};

type ReaderResult = {
  documents: DocumentRow[];
  existing: ExistingRow[];
};

type WriterInput = {
  upserts: UpsertRow[];
  deletes: string[];
};

type RefreshOptions = {
  limit?: number;
  dryRun?: boolean;
  jobId?: string;
  reader?: () => Promise<ReaderResult>;
  writer?: (input: WriterInput) => Promise<void>;
  embedder?: (inputs: string[]) => Promise<EmbeddingsResult>;
};

type RefreshResult = {
  stale: number;
  embedded: number;
  deleted: number;
  failedBatches: string[];
  costUsd?: number;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function planEmbeddingRefresh(
  documents: DocumentRow[] | Pick<DocumentRow, "product_id" | "source_hash">[],
  existing: ExistingRow[],
): EmbeddingPlan {
  const existingMap = new Map(
    existing.map((row) => [row.product_id, row.source_hash]),
  );
  const documentIds = new Set(documents.map((d) => d.product_id));

  const stale = (documents as DocumentRow[]).filter((doc) => {
    const currentHash = existingMap.get(doc.product_id);
    return currentHash === undefined || currentHash !== doc.source_hash;
  });

  const orphanIds = existing
    .filter((row) => !documentIds.has(row.product_id))
    .map((row) => row.product_id);

  return { stale, orphanIds };
}

export function chunkInputs<T>(items: T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += EMBEDDING_BATCH_SIZE) {
    chunks.push(items.slice(i, i + EMBEDDING_BATCH_SIZE));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Default reader / writer (Supabase)
// ---------------------------------------------------------------------------

const PAGE_SIZE = 500;

async function defaultReader(limit: number): Promise<ReaderResult> {
  const { createServiceClient } = await import("@/lib/supabase/service");
  const supabase = createServiceClient();

  const documents: DocumentRow[] = [];
  let from = 0;
  while (documents.length < limit) {
    const pageSize = Math.min(PAGE_SIZE, limit - documents.length);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types until migration apply + db:types
    const { data, error } = await (supabase as any)
      .from("product_embedding_documents")
      .select("product_id, source_hash, content")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    documents.push(...data);
    from += data.length;
    if (data.length < pageSize) break;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types until migration apply + db:types
  const { data: existingData, error: existingError } = await (supabase as any)
    .from("product_embeddings")
    .select("product_id, source_hash");
  if (existingError) throw new Error(existingError.message);

  return { documents, existing: existingData ?? [] };
}

async function defaultWriter(input: WriterInput): Promise<void> {
  const { createServiceClient } = await import("@/lib/supabase/service");
  const supabase = createServiceClient();

  if (input.upserts.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types until migration apply + db:types
    const { error } = await (supabase as any)
      .from("product_embeddings")
      .upsert(input.upserts, { onConflict: "product_id" });
    if (error) throw new Error(error.message);
  }

  if (input.deletes.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types until migration apply + db:types
    const { error } = await (supabase as any)
      .from("product_embeddings")
      .delete()
      .in("product_id", input.deletes);
    if (error) throw new Error(error.message);
  }
}

// ---------------------------------------------------------------------------
// Main refresh function
// ---------------------------------------------------------------------------

export async function refreshProductEmbeddings(
  options: RefreshOptions = {},
): Promise<RefreshResult> {
  const {
    limit = 2000,
    dryRun = false,
    jobId,
    reader,
    writer,
    embedder,
  } = options;

  const readResult = await (reader ?? (() => defaultReader(limit)))();
  const plan = planEmbeddingRefresh(readResult.documents, readResult.existing);

  if (dryRun) {
    return {
      stale: plan.stale.length,
      embedded: 0,
      deleted: 0,
      failedBatches: [],
    };
  }

  const embed =
    embedder ??
    ((inputs: string[]) => {
      const client = createAuditedEmbeddingsClient({
        phase: "product_embeddings",
        jobId,
      });
      return client.embed(inputs);
    });

  const batches = chunkInputs(plan.stale);
  const allUpserts: UpsertRow[] = [];
  const failedBatches: string[] = [];

  for (const batch of batches) {
    try {
      const result = await embed(batch.map((doc) => doc.content));
      for (let i = 0; i < batch.length; i++) {
        allUpserts.push({
          product_id: batch[i]!.product_id,
          embedding: JSON.stringify(result.vectors[i]),
          model: result.model ?? EMBEDDING_MODEL,
          source_hash: batch[i]!.source_hash,
        });
      }
    } catch (error) {
      failedBatches.push(
        error instanceof Error ? error.message : String(error),
      );
      // Stop after first failed batch.
      break;
    }
  }

  const write = writer ?? defaultWriter;
  if (allUpserts.length > 0 || plan.orphanIds.length > 0) {
    await write({ upserts: allUpserts, deletes: plan.orphanIds });
  }

  return {
    stale: plan.stale.length,
    embedded: allUpserts.length,
    deleted: plan.orphanIds.length,
    failedBatches,
  };
}
