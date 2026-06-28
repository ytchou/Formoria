import { headers } from "next/headers";

/** Static fallback for contexts where request headers aren't available (e.g. email links). */
export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

/** Derive origin from the current request so localhost stays localhost and prod stays prod. */
export async function getRequestOrigin(): Promise<string> {
  const h = await headers();
  const forwardedHost = h.get("x-forwarded-host");
  const forwardedProto = h.get("x-forwarded-proto")?.split(",")[0];
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  // Validate x-forwarded-host against the expected site URL to prevent open redirects.
  if (forwardedHost && siteUrl) {
    const expectedHost = new URL(siteUrl).host;
    if (forwardedHost !== expectedHost) {
      return siteUrl.replace(/\/$/, "");
    }
  }

  if (forwardedHost) {
    const proto = forwardedProto ?? "https";
    return `${proto}://${forwardedHost}`;
  }

  return (siteUrl ?? "http://localhost:3000").replace(/\/$/, "");
}
