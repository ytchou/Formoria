import { headers } from "next/headers";
import { isStagingRequest } from "@/lib/deployment-environment";
import { verifyStagingSessionHeaders } from "@/lib/security/staging-session";

/**
 * Whether the auth pages offer Google, password reset and sign-up links.
 *
 * Staging hides them unless the request carries a verified staging session.
 * Sign-in and sign-up both read this one answer so neither page's copy or
 * buttons promise a method the other hides.
 */
export async function shouldShowOptionalAuthMethods(): Promise<boolean> {
  const headerStore = await headers();
  const requestHost =
    headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  return (
    !isStagingRequest(requestHost) ||
    Boolean(await verifyStagingSessionHeaders(headerStore))
  );
}
