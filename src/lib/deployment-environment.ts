const STAGING_HOST = "staging.formoria.com";

export function isStagingEnvironment(): boolean {
  return [
    process.env.FORMORIA_DEPLOYMENT_ENV,
    process.env.RAILWAY_ENVIRONMENT_NAME,
    process.env.NEXT_PUBLIC_DEPLOYMENT_ENV,
  ].some((value) => value?.trim().toLowerCase() === "staging");
}

export function isStagingHost(host: string | null): boolean {
  return host?.split(":")[0]?.trim().toLowerCase() === STAGING_HOST;
}

export function isStagingRequest(host: string | null): boolean {
  return isStagingEnvironment() || isStagingHost(host);
}

const STAGING_GET_MUTATION_PATHS = new Set([
  "/api/claim/verify-email",
  "/api/email/unsubscribe",
  "/api/newsletter/confirm",
  "/api/newsletter/unsubscribe",
]);

const STAGING_DISABLED_AUTH_PATHS = new Set([
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/sign-up",
]);

function withoutLocale(pathname: string): string {
  return pathname.replace(/^\/(?:en|zh-TW)(?=\/)/, "");
}

export function isAllowedStagingRequest(
  method: string,
  pathname: string,
): boolean {
  const normalizedPath = withoutLocale(pathname);

  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return (
      !STAGING_GET_MUTATION_PATHS.has(normalizedPath) &&
      !STAGING_DISABLED_AUTH_PATHS.has(normalizedPath)
    );
  }

  if (method !== "POST") return false;

  return (
    normalizedPath === "/auth/sign-in" ||
    normalizedPath === "/auth/sign-out"
  );
}
