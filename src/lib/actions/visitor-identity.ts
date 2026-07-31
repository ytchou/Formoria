import { cookies } from "next/headers";

import {
  BRAND_LIKE_VISITOR_COOKIE,
  BRAND_LIKE_VISITOR_COOKIE_OPTIONS,
  hashBrandLikeVisitorId,
  signBrandLikeVisitorId,
  verifyBrandLikeVisitorId,
} from "@/lib/security/brand-like-identity";

/**
 * Reads the signed anonymous-visitor cookie, minting and setting one when it is
 * absent or invalid, and returns its hash.
 *
 * Single source of cookie issuance for anonymous write paths: likes,
 * corrections, and feature-request votes must derive the same `visitor_hash`
 * for one browser, because the dedup indexes keyed on it only match prior
 * writes when the cookie is issued identically everywhere.
 *
 * Deliberately not in `@/lib/security/brand-like-identity` — that module is
 * pure WebCrypto and stays runtime-agnostic; `cookies()` would make it
 * server-only.
 */
export async function ensureVisitorHash(): Promise<string> {
  const cookieStore = await cookies();
  let visitorId = await verifyBrandLikeVisitorId(
    cookieStore.get(BRAND_LIKE_VISITOR_COOKIE)?.value,
  );

  if (!visitorId) {
    visitorId = crypto.randomUUID();
    cookieStore.set(
      BRAND_LIKE_VISITOR_COOKIE,
      await signBrandLikeVisitorId(visitorId),
      BRAND_LIKE_VISITOR_COOKIE_OPTIONS,
    );
  }

  return hashBrandLikeVisitorId(visitorId);
}

/**
 * Hash of the existing anonymous-visitor cookie, or null when the browser has
 * none. Read-only on purpose: a read path must not mint identity, both because
 * a React Server Component render cannot set a cookie and because "which
 * requests did I vote for" should not create a tracking identifier for a
 * visitor who has never written anything.
 */
export async function readVisitorHash(): Promise<string | null> {
  const cookieStore = await cookies();
  const visitorId = await verifyBrandLikeVisitorId(
    cookieStore.get(BRAND_LIKE_VISITOR_COOKIE)?.value,
  );

  return visitorId ? hashBrandLikeVisitorId(visitorId) : null;
}
