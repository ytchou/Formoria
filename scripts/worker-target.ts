import {
  PRODUCTION_PROJECT_REF,
  STAGING_PROJECT_REF,
  projectRefFromSupabaseUrl,
  validateSupabaseKeyIdentity,
} from "./staging-target";

export type WorkerDeploymentEnvironment = "production" | "staging";

const EXPECTED_PROJECT_REFS: Record<WorkerDeploymentEnvironment, string> = {
  production: PRODUCTION_PROJECT_REF,
  staging: STAGING_PROJECT_REF,
};

type Environment = Record<string, string | undefined>;

export type WorkerTarget = {
  deploymentEnvironment: WorkerDeploymentEnvironment;
  projectRef: string;
};

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for the curation worker`);
  return value;
}

/**
 * Assert that the worker's database credentials belong to the environment it
 * declares itself to be, before it can claim or write a single job.
 *
 * The declaration side is fail-open by design: an unset FORMORIA_DEPLOYMENT_ENV
 * resolves to production. That is safe only while something independent proves
 * which database is actually attached, which is what this does — the connection
 * URL and the service-role JWT must both name the declared project. A staging
 * worker holding production credentials, or a production worker whose
 * environment variable was never set but whose key points at staging, fails to
 * boot rather than enriching the wrong database.
 */
export function assertWorkerDatabaseTarget(
  deploymentEnvironment: WorkerDeploymentEnvironment,
  environment: Environment = process.env,
): WorkerTarget {
  const expectedRef = EXPECTED_PROJECT_REFS[deploymentEnvironment];

  const urlProjectRef = projectRefFromSupabaseUrl(
    required(environment, "NEXT_PUBLIC_SUPABASE_URL"),
  );
  if (urlProjectRef !== expectedRef) {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL identifies project ${urlProjectRef}, but this worker declares ${deploymentEnvironment} (${expectedRef})`,
    );
  }

  validateSupabaseKeyIdentity(
    required(environment, "SUPABASE_SERVICE_ROLE_KEY"),
    "SUPABASE_SERVICE_ROLE_KEY",
    expectedRef,
    "service_role",
  );

  return { deploymentEnvironment, projectRef: expectedRef };
}
