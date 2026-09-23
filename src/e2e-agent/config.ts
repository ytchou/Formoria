import {
  projectRefFromDatabaseUrl,
  validateStagingTarget,
  type StagingTarget,
} from "@/lib/supabase/project-target";

type Environment = Record<string, string | undefined>;

const REQUIRED_AGENT_VARIABLES = [
  "E2E_ADMIN_EMAIL",
  "E2E_ADMIN_PASSWORD",
  "E2E_USER_EMAIL",
  "E2E_USER_PASSWORD",
  "E2E_STAGING_SESSION_SECRET",
  "E2E_ORIGIN_SECRET",
  "CF_ACCESS_CLIENT_ID",
  "CF_ACCESS_CLIENT_SECRET",
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_INSTALLATION_ID",
  "SLACK_BOT_TOKEN",
  "SLACK_E2E_CHANNEL",
  "OPS_AGENT_SLACK_BOT_ID",
] as const;

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for the E2E agent`);
  return value;
}

/**
 * Fail closed before importing any service that can clone or mutate staging.
 * Every credential used by the complete run is checked here so a scheduled
 * invocation cannot become partially green through missing reporting
 * configuration.
 */
export function validateE2eAgentConfig(
  environment: Environment = process.env,
): StagingTarget {
  const target = validateStagingTarget(environment);
  const databaseUrl = required(environment, "SUPABASE_DB_URL");
  const databaseProjectRef = projectRefFromDatabaseUrl(databaseUrl);
  if (databaseProjectRef !== target.projectRef) {
    throw new Error(
      `SUPABASE_DB_URL identifies project ${databaseProjectRef ?? "unknown"}, not staging project ${target.projectRef}`,
    );
  }

  for (const name of REQUIRED_AGENT_VARIABLES) {
    required(environment, name);
  }

  const adminEmail = required(environment, "E2E_ADMIN_EMAIL").toLowerCase();
  const userEmail = required(environment, "E2E_USER_EMAIL").toLowerCase();
  const adminEmails = required(environment, "ADMIN_EMAILS")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (!adminEmails.includes(adminEmail)) {
    throw new Error(
      "ADMIN_EMAILS must include E2E_ADMIN_EMAIL for the E2E agent",
    );
  }
  if (adminEmail === userEmail) {
    throw new Error(
      "E2E_ADMIN_EMAIL and E2E_USER_EMAIL must identify different accounts",
    );
  }

  return target;
}
