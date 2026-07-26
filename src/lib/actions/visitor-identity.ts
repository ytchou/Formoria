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
 * Single source of cookie issuance for anonymous write paths: likes and
 * corrections must derive the same `visitor_hash` for one browser, because the
 * `(brand_id, visitor_hash, field)` dedup index only matches prior submissions
 * when the cookie is issued identically everywhere.
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
