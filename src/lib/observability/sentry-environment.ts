/**
 * Which environment a Sentry event came from, resolved from a deploy marker
 * rather than from `NODE_ENV`.
 *
 * `NODE_ENV` is `production` for any local `next build` + `next start`, and
 * `.env.local` carries the production DSN and site URL, so a laptop running the
 * prod-parity harness is indistinguishable from Railway by every value the app
 * itself holds. Sentry's own default is `SENTRY_ENVIRONMENT ?? NODE_ENV`, which
 * is exactly why 14 of the 21 events on FORMORIA-2H arrived tagged
 * `environment: production` from `http://localhost:3123` — the issue's culprit
 * and "last seen" both came from a developer's machine and it read as a live
 * production defect (DEV-1561).
 *
 * The only honest signal is a variable the deploy platform injects and a laptop
 * does not have. Absence means local, and local never claims to be production.
 */

/** Variables that name the environment, most specific first. */
const ENVIRONMENT_MARKERS = [
  // Explicit override — set this to report under a name of your choosing.
  "SENTRY_ENVIRONMENT",
  "NEXT_PUBLIC_SENTRY_ENVIRONMENT",
  // Injected by Railway at runtime. `NEXT_PUBLIC_` mirror is inlined into the
  // browser bundle by `next.config.ts`, which is the only way the client build
  // can see it.
  "RAILWAY_ENVIRONMENT_NAME",
  "NEXT_PUBLIC_RAILWAY_ENVIRONMENT_NAME",
] as const;

/** What an event reports when no deploy marker is present. */
export const LOCAL_ENVIRONMENT = "local";

export function resolveSentryEnvironment(
  env: Record<string, string | undefined> = process.env,
): string {
  for (const marker of ENVIRONMENT_MARKERS) {
    const value = env[marker]?.trim();
    if (value) {
      return value.toLowerCase();
    }
  }

  return LOCAL_ENVIRONMENT;
}

/**
 * Hosts that only ever serve a developer's own machine. Matched on the whole
 * hostname or on a trailing label, never as a substring — `localhost.formoria.com`
 * is a public host and must keep reporting.
 */
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const LOCAL_SUFFIXES = [".local", ".localhost"];

/**
 * The second net: even correctly tagged, a local event is noise in a production
 * project. `event.request.url` is the one field that survives the harness.
 */
export function isLocalRequestUrl(url: string | undefined | null): boolean {
  if (!url) {
    return false;
  }

  let hostname: string;
  try {
    // `URL` strips the brackets from an IPv6 host, so `[::1]` arrives as `::1`.
    hostname = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }

  return (
    LOCAL_HOSTNAMES.has(hostname) ||
    LOCAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  );
}
