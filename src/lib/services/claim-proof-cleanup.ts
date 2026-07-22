import { createServiceClient } from "@/lib/supabase/server";
import { randomUUID } from "node:crypto";

const CLAIM_PROOF_BUCKET = "claim-proofs";
const CLAIM_PROOF_PREFIX = `${CLAIM_PROOF_BUCKET}/`;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1_000;

type CleanupJob = {
  job_id: string;
  storage_key: string;
};

type RpcError = { message: string };

type CleanupClient = {
  rpc(
    fn:
      | "enqueue_abandoned_claim_proof_cleanup_jobs"
      | "claim_claim_proof_cleanup_jobs"
      | "complete_claim_proof_cleanup_jobs"
      | "fail_claim_proof_cleanup_jobs",
    params?: Record<string, unknown>,
  ): Promise<{ data: unknown; error: RpcError | null }>;
  storage: {
    from(bucket: typeof CLAIM_PROOF_BUCKET): {
      remove(paths: string[]): Promise<{ error: RpcError | null }>;
    };
  };
};

export type ProcessClaimProofCleanupOptions = {
  claimRequestId?: string;
  includeAbandoned?: boolean;
  limit?: number;
};

export type ClaimProofCleanupSummary = {
  claimed: number;
  completed: number;
  failed: number;
};

function cleanupClient(): CleanupClient {
  return createServiceClient() as unknown as CleanupClient;
}

function throwIfError(error: RpcError | null): void {
  if (error) throw new Error(error.message);
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

function claimProofPath(storageKey: string): string | null {
  if (!storageKey.startsWith(CLAIM_PROOF_PREFIX)) return null;
  const path = storageKey.slice(CLAIM_PROOF_PREFIX.length);
  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        !segment || segment === "." || segment === ".." || segment.includes("\\"),
    )
  ) {
    return null;
  }
  return path;
}

export async function processClaimProofCleanup(
  options: ProcessClaimProofCleanupOptions = {},
): Promise<ClaimProofCleanupSummary> {
  const client = cleanupClient();
  const leaseToken = randomUUID();

  if (options.includeAbandoned) {
    const { error } = await client.rpc(
      "enqueue_abandoned_claim_proof_cleanup_jobs",
    );
    throwIfError(error);
  }

  const { data, error: claimError } = await client.rpc(
    "claim_claim_proof_cleanup_jobs",
    {
      p_lease_token: leaseToken,
      p_claim_request_id: options.claimRequestId ?? null,
      p_limit: normalizeLimit(options.limit),
    },
  );
  throwIfError(claimError);

  const jobs = Array.isArray(data) ? (data as CleanupJob[]) : [];
  if (jobs.length === 0) return { claimed: 0, completed: 0, failed: 0 };

  const validJobs = jobs.flatMap((job) => {
    const path = claimProofPath(job.storage_key);
    return path ? [{ id: job.job_id, path }] : [];
  });
  const validIds = validJobs.map((job) => job.id);
  const validIdSet = new Set(validIds);
  const invalidIds = jobs
    .filter((job) => !validIdSet.has(job.job_id))
    .map((job) => job.job_id);

  if (validJobs.length > 0) {
    const { error: storageError } = await client.storage
      .from(CLAIM_PROOF_BUCKET)
      .remove(validJobs.map((job) => job.path));

    if (storageError) {
      const failures = [
        client.rpc("fail_claim_proof_cleanup_jobs", {
          p_job_ids: validIds,
          p_lease_token: leaseToken,
          p_error: storageError.message,
        }),
      ];
      if (invalidIds.length > 0) {
        failures.push(
          client.rpc("fail_claim_proof_cleanup_jobs", {
            p_job_ids: invalidIds,
            p_lease_token: leaseToken,
            p_error: "invalid claim proof storage key",
          }),
        );
      }
      const results = await Promise.all(failures);
      results.forEach(({ error }) => throwIfError(error));
      return { claimed: jobs.length, completed: 0, failed: jobs.length };
    }
  }

  const finalizations: Promise<{ data: unknown; error: RpcError | null }>[] = [];
  if (validIds.length > 0) {
    finalizations.push(
      client.rpc("complete_claim_proof_cleanup_jobs", {
        p_job_ids: validIds,
        p_lease_token: leaseToken,
      }),
    );
  }
  if (invalidIds.length > 0) {
    finalizations.push(
      client.rpc("fail_claim_proof_cleanup_jobs", {
        p_job_ids: invalidIds,
        p_lease_token: leaseToken,
        p_error: "invalid claim proof storage key",
      }),
    );
  }
  const results = await Promise.all(finalizations);
  results.forEach(({ error }) => throwIfError(error));

  return {
    claimed: jobs.length,
    completed: validJobs.length,
    failed: invalidIds.length,
  };
}
