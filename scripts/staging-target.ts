export const STAGING_PROJECT_REF = "xwkigpvnheecihpxyvsl";
export const STAGING_HOSTNAME = "staging.formoria.com";
export const STAGING_BASE_URL = `https://${STAGING_HOSTNAME}`;

type Environment = Record<string, string | undefined>;

type SupabaseKeyRole = "anon" | "service_role";

type SupabaseKeyPayload = {
  ref?: unknown;
  role?: unknown;
};

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for staging E2E`);
  return value;
}

function parseHttpsUrl(value: string, name: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${name} must use https://`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${name} must not contain credentials or query parameters`);
  }
  return parsed;
}

/**
 * The installed Supabase client accepts both legacy JWT keys and the newer
 * publishable/secret key strings. Only the JWT form exposes a project ref and
 * role locally, so staging guards reject every other form instead of guessing
 * at an authoritative identity source.
 */
export function validateSupabaseKeyIdentity(
  value: string,
  name: string,
  expectedRef: string,
  expectedRole: SupabaseKeyRole,
): SupabaseKeyPayload {
  const parts = value.trim().split(".");
  if (
    parts.length !== 3 ||
    parts.some((part) => !part || !/^[A-Za-z0-9_-]+$/.test(part))
  ) {
    throw new Error(
      `${name} must be a Supabase JWT with a verifiable staging project ref; publishable/secret key formats are rejected`,
    );
  }

  let payload: SupabaseKeyPayload;
  try {
    const decoded = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as unknown;
    if (!decoded || typeof decoded !== "object") throw new Error("not an object");
    payload = decoded as SupabaseKeyPayload;
  } catch {
    throw new Error(`${name} contains an invalid Supabase JWT payload`);
  }

  if (payload.ref !== expectedRef) {
    throw new Error(
      `${name} identifies project ${String(payload.ref ?? "missing")}, not staging project ${expectedRef}`,
    );
  }
  if (payload.role !== expectedRole) {
    throw new Error(
      `${name} has role ${String(payload.role ?? "missing")}, expected ${expectedRole}`,
    );
  }
  return payload;
}

export function projectRefFromSupabaseUrl(value: string): string {
  const parsed = parseHttpsUrl(value, "NEXT_PUBLIC_SUPABASE_URL");
  if (parsed.pathname !== "/" || parsed.port) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL must be the canonical hosted project URL",
    );
  }
  const match = parsed.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/i);
  if (!match) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL must identify a hosted Supabase project",
    );
  }
  return match[1].toLowerCase();
}

export type StagingTarget = {
  appUrl: string;
  appHostname: string;
  projectRef: string;
  supabaseUrl: string;
};

/**
 * Validate the complete E2E identity tuple before any browser or database
 * mutation. A staging environment name by itself is not evidence: a copied
 * production URL or Supabase project must fail closed.
 */
export function validateStagingTarget(
  environment: Environment = process.env,
): StagingTarget {
  const declaredEnvironment = required(environment, "FORMORIA_DEPLOYMENT_ENV");
  if (declaredEnvironment.toLowerCase() !== "staging") {
    throw new Error(
      `E2E and staging seed are disabled for ${declaredEnvironment}; FORMORIA_DEPLOYMENT_ENV must be staging`,
    );
  }

  const appValue = environment.STAGING_BASE_URL ?? environment.BASE_URL;
  if (!appValue?.trim()) {
    throw new Error("STAGING_BASE_URL is required for staging E2E");
  }
  const appUrl = parseHttpsUrl(appValue.trim(), "STAGING_BASE_URL");
  for (const name of [
    "BASE_URL",
    "PLAYWRIGHT_BASE_URL",
    "NEXT_PUBLIC_SITE_URL",
    "FORMORIA_RUNTIME_URL",
  ]) {
    const declaredOrigin = environment[name]?.trim();
    if (
      declaredOrigin &&
      parseHttpsUrl(declaredOrigin, name).toString() !== appUrl.toString()
    ) {
      throw new Error(`${name} and STAGING_BASE_URL must identify the same staging origin`);
    }
  }
  if (appUrl.hostname.toLowerCase() !== STAGING_HOSTNAME) {
    throw new Error(
      `STAGING_BASE_URL must use ${STAGING_HOSTNAME}, not ${appUrl.hostname}`,
    );
  }
  if (appUrl.pathname !== "/") {
    throw new Error("STAGING_BASE_URL must not include a path");
  }

  const supabaseUrl = required(environment, "NEXT_PUBLIC_SUPABASE_URL");
  const projectRef = required(environment, "SUPABASE_PROJECT_REF").toLowerCase();
  const urlProjectRef = projectRefFromSupabaseUrl(supabaseUrl);
  if (projectRef !== STAGING_PROJECT_REF) {
    throw new Error(
      `SUPABASE_PROJECT_REF must be ${STAGING_PROJECT_REF} for staging`,
    );
  }
  if (urlProjectRef !== projectRef) {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL identifies project ${urlProjectRef}, not SUPABASE_PROJECT_REF ${projectRef}`,
    );
  }

  validateSupabaseKeyIdentity(
    required(environment, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    projectRef,
    "anon",
  );
  validateSupabaseKeyIdentity(
    required(environment, "SUPABASE_SERVICE_ROLE_KEY"),
    "SUPABASE_SERVICE_ROLE_KEY",
    projectRef,
    "service_role",
  );

  return {
    appUrl: appUrl.toString().replace(/\/$/, ""),
    appHostname: appUrl.hostname.toLowerCase(),
    projectRef,
    supabaseUrl: new URL(supabaseUrl).toString().replace(/\/$/, ""),
  };
}

export function assertStagingRevision(
  expectedSha: string,
  observedRevision: string | null | undefined,
): void {
  const expected = expectedSha.trim().toLowerCase();
  const observed = observedRevision?.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(expected)) {
    throw new Error("Expected staging revision must be a 40-character Git SHA");
  }
  if (observed !== expected) {
    throw new Error(
      `Staging revision mismatch: expected ${expected}, observed ${observed ?? "missing"}`,
    );
  }
}
