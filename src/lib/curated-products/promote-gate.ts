/**
 * The promote gate for curated products (DEV-1465) — ONE definition, imported
 * by both sides.
 *
 * It lives in its own PURE module, with no Supabase client and no service
 * imports, because the admin drawer renders the same four conditions as a
 * pass/fail readout in a CLIENT component. `@/lib/services/curated-products`
 * cannot be imported there: it reaches `@/lib/services/brands`, which pulls in
 * `server-only`. Copying the four conditions into the UI instead is exactly the
 * drift this file exists to prevent — a curator being told a product is ready
 * by a screen the writer then refuses.
 *
 * `@/lib/services/curated-products` re-exports both symbols, so the service
 * remains the import site for server code.
 */

export type PromoteBlocker =
  "official_url" | "source_checked_at" | "no_active_source" | "lifecycle";

export type PromoteOutcome =
  { ok: true } | { ok: false; blockers: PromoteBlocker[]; error: string };

/** The lifecycle values a product may be promoted FROM. */
const PROMOTABLE_LIFECYCLES = new Set(["candidate", "needs_review"]);

/**
 * The single definition of "may this product be published".
 *
 * `link_state` is deliberately NOT a condition. A broken link suppresses the
 * call-to-action on the card; it does not make the editorial claim untrue, and
 * the read query does not filter on it either.
 */
export function curatedProductPromoteBlockers(
  product: {
    lifecycle: string;
    officialUrl: string | null;
    sourceCheckedAt: string | null;
  },
  sources: readonly { state: string }[],
): PromoteBlocker[] {
  const blockers: PromoteBlocker[] = [];
  if (!product.officialUrl) blockers.push("official_url");
  if (!product.sourceCheckedAt) blockers.push("source_checked_at");
  // Retire-never-delete: a row's presence is not evidence, only its state is.
  if (!sources.some((source) => source.state === "active")) {
    blockers.push("no_active_source");
  }
  if (!PROMOTABLE_LIFECYCLES.has(product.lifecycle)) blockers.push("lifecycle");
  return blockers;
}
