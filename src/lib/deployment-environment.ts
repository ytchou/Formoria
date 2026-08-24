import { routes } from '@/lib/routes'

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
  "/api/email/unsubscribe",
  "/api/newsletter/confirm",
  "/api/newsletter/unsubscribe",
]);

const STAGING_PUBLIC_AUTH_PATHS = new Set([
  routes.auth.forgotPassword(),
  routes.auth.resetPassword(),
  routes.auth.signUp(),
]);

function withoutLocale(pathname: string): string {
  return pathname.replace(/^\/(?:en|zh-TW)(?=\/)/, "");
}

export function isAllowedStagingRequest(
  method: string,
  pathname: string,
  authenticated = false,
): boolean {
  const normalizedPath = withoutLocale(pathname);

  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return !STAGING_GET_MUTATION_PATHS.has(normalizedPath);
  }

  if (
    method === "POST" &&
    (normalizedPath === routes.auth.signIn() ||
      normalizedPath === routes.auth.signOut() ||
      STAGING_PUBLIC_AUTH_PATHS.has(normalizedPath))
  ) {
    return true;
  }

  return authenticated && ["POST", "PUT", "PATCH", "DELETE"].includes(method);
}
