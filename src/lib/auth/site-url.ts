import { headers } from "next/headers";
import { getSiteUrl } from "../site-url";

export { getSiteUrl };

export async function getRequestOrigin(): Promise<string> {
  const h = await headers();
  const forwardedHost = h.get("x-forwarded-host");
  const forwardedProto = h.get("x-forwarded-proto")?.split(",")[0];
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  const host = forwardedHost ?? h.get("host");

  if (host) {
    const isLocal =
      host.startsWith("localhost") || host.startsWith("127.0.0.1");

    if (isLocal) {
      return `http://${host}`;
    }

    // Behind a reverse proxy: validate forwarded host against expected site URL
    // to prevent open redirects via spoofed x-forwarded-host headers.
    if (forwardedHost && siteUrl) {
      const expectedHost = new URL(siteUrl).host;
      if (forwardedHost !== expectedHost) {
        return siteUrl.replace(/\/$/, "");
      }
    }

    const proto = forwardedProto ?? "https";
    return `${proto}://${host}`;
  }

  return getSiteUrl();
}
