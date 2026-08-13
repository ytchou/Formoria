import { createClient as createSupabaseClient } from "@supabase/supabase-js";

type SupabaseTrafficContext =
  "build" | "runtime" | "development" | "test" | "script";

export type SupabaseUserAgentOptions = {
  nodeEnv?: string;
  nextPhase?: string;
  argv?: readonly string[];
  railwayCommitSha?: string;
};

const SCRIPT_PATH_PATTERN = /(?:^|[\\/])scripts(?:[\\/]|$)/;

/**
 * Classifies the owner of a server-side Supabase request without inspecting
 * request data or credentials. The explicit input keeps this decision pure
 * and easy to exercise without constructing a client.
 */
function getSupabaseTrafficContext({
  nodeEnv,
  nextPhase,
  argv = [],
}: SupabaseUserAgentOptions): SupabaseTrafficContext {
  if (nextPhase === "phase-production-build") return "build";
  if (nodeEnv === "test") return "test";
  if (argv.some((argument) => SCRIPT_PATH_PATTERN.test(argument))) {
    return "script";
  }
  if (argv.some((argument) => argument === "build")) return "build";
  if (nodeEnv === "development") return "development";
  return "runtime";
}

function shortCommitSha(value: string | undefined): string | undefined {
  const sanitized = value
    ?.trim()
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 7);
  return sanitized || undefined;
}

/**
 * Builds the non-PII User-Agent used for server-side Supabase requests.
 * `x-client-info` remains owned by supabase-js through its default headers.
 */
export function buildSupabaseUserAgent(
  options: SupabaseUserAgentOptions,
): string {
  const context = getSupabaseTrafficContext(options);
  const commit = shortCommitSha(options.railwayCommitSha);
  return `FormoriaSupabase/1.0 (${context}${commit ? `; commit=${commit}` : ""})`;
}

/**
 * Creates a Supabase client using the service role key.
 * Bypasses RLS — use only in service layer functions for admin operations.
 * Does not need cookies since the service role key grants full access.
 *
 * This module deliberately has no Next.js-only imports so it can be loaded by
 * the curation worker and other plain Node scripts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _serviceClient: ReturnType<typeof createSupabaseClient<any>> | null = null;

export function createServiceClient() {
  if (!_serviceClient) {
    _serviceClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        global: {
          headers: {
            "User-Agent": buildSupabaseUserAgent({
              nodeEnv: process.env.NODE_ENV,
              nextPhase: process.env.NEXT_PHASE,
              argv: process.argv,
              railwayCommitSha: process.env.RAILWAY_GIT_COMMIT_SHA,
            }),
          },
        },
      },
    );
  }
  return _serviceClient;
}
