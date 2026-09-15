/**
 * Ops agent readers — thin wrappers around service calls and Supabase selects.
 *
 * Each reader wraps its work in `auditedCall` for audit trail purposes. All
 * external dependencies (Supabase client, service functions) are injected via
 * the `deps` parameter to allow DI in tests.
 */

import { auditedCall } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/service";

type SupabaseClient = ReturnType<typeof createServiceClient>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SystemStatusDeps = {
  client?: SupabaseClient;
  listCurationJobs: (options: { limit: number }) => Promise<{ jobs: unknown[] }>;
};

export type SystemStatusResult = {
  healthRuns: unknown[];
  fixQueue: unknown;
  jobs: unknown[];
};

export type BrandContextDeps = {
  client?: SupabaseClient;
  searchBrandsAutocomplete: (query: string) => Promise<unknown[]>;
  getBrandBySlug: (slug: string) => Promise<unknown>;
};

export type JobDetailDeps = {
  getCurationJobDetail: (jobId: string) => Promise<unknown>;
};

// ---------------------------------------------------------------------------
// runReadonlyQuery
// ---------------------------------------------------------------------------

export async function runReadonlyQuery(
  sql: string,
  client?: SupabaseClient,
): Promise<unknown> {
  return auditedCall(
    { provider: "ops-agent", operation: "runReadonlyQuery", kind: "service" },
    async () => {
      const supabase = client ?? createServiceClient();
      const { data, error } = await supabase.rpc("ops_agent_readonly_query", {
        p_sql: sql,
      });
      if (error) throw new Error(`runReadonlyQuery failed: ${error.message}`);
      return data;
    },
  );
}

// ---------------------------------------------------------------------------
// systemStatus
// ---------------------------------------------------------------------------

export async function systemStatus(
  deps: SystemStatusDeps,
): Promise<SystemStatusResult> {
  return auditedCall(
    { provider: "ops-agent", operation: "systemStatus", kind: "service" },
    async () => {
      const supabase = deps.client ?? createServiceClient();

      const [healthResult, fixQueueResult, jobsResult] = await Promise.all([
        supabase
          .from("health_agent_run_ledger")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(3)
          .then(({ data, error }) => {
            if (error) return { error: error.message };
            return data ?? [];
          }),
        supabase
          .from("health_fix_queue")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(20)
          .then(({ data, error }) => {
            if (error) return { error: error.message };
            return data ?? [];
          }),
        deps
          .listCurationJobs({ limit: 5 })
          .then((page) => page.jobs)
          .catch((err: Error) => ({ error: err.message })),
      ]);

      return {
        healthRuns: healthResult as unknown[],
        fixQueue: fixQueueResult,
        jobs: jobsResult as unknown[],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// brandContext
// ---------------------------------------------------------------------------

export async function brandContext(
  query: string,
  deps: BrandContextDeps,
): Promise<Record<string, unknown>> {
  return auditedCall(
    { provider: "ops-agent", operation: "brandContext", kind: "service" },
    async () => {
      const supabase = deps.client ?? createServiceClient();

      // Try exact slug match first
      let brand: unknown = null;
      try {
        brand = await deps.getBrandBySlug(query);
      } catch {
        // Not an exact slug — fall through to search
      }

      if (brand) {
        // Fetch recent curation_job_targets for this brand
        const { data: targets } = await supabase
          .from("curation_job_targets")
          .select("*")
          .eq("brand_slug", query)
          .order("created_at", { ascending: false })
          .limit(3);

        return { brand, recentTargets: targets ?? [] };
      }

      // Ambiguous query — search
      const searchResults = await deps.searchBrandsAutocomplete(query);
      return { searchResults };
    },
  );
}

// ---------------------------------------------------------------------------
// jobDetail
// ---------------------------------------------------------------------------

export async function jobDetail(
  jobId: string,
  deps: JobDetailDeps,
): Promise<unknown> {
  return auditedCall(
    { provider: "ops-agent", operation: "jobDetail", kind: "service" },
    async () => {
      return deps.getCurationJobDetail(jobId);
    },
  );
}
