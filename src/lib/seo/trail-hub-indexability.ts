import type { TrailEntry } from "@/lib/services/trails";

/**
 * Whether `/discover` is worth indexing and listing in the sitemap.
 *
 * Lives here rather than on the hub page because two surfaces answer with it —
 * the page's `robots` directive and the sitemap's hub entry — and a route
 * module must not import a page module to reach shared logic. One predicate
 * keeps them from disagreeing: a sitemap that submits a URL the page marks
 * `noindex` is the "Submitted URL marked noindex" report in Search Console.
 *
 * This is a publication check, not a quality one. DEV-1518 deleted the
 * render-time supply gate; a hub with one small trail indexes, and only a hub
 * with nothing published does not.
 */
export function shouldIndexTrailHub(trails: readonly TrailEntry[]): boolean {
  return trails.length > 0;
}
