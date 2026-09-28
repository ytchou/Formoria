import { isPrivateUrl } from "@/lib/url";
import { MAX_PROBE_URLS, MAX_RESULT_LINES } from "@/lib/prompts/detect-message";
import { canonicalizeThreadsUrl, pageKeyHost } from "../link-enrichment";
import type { ProbeEvidence } from "./gather";
import { isNonBrandSiteHost } from "./scraper/input-detector";
import { extractInstagramHandle, hostMatches } from "./scraper/parse/extractors";
import { stripTrackingParams } from "./scraper/search";
import type { BrandSearchEntry } from "./scraper/types";

/**
 * Pure projections from gather's in-memory evidence (SERP entries, the
 * brand's owned URLs, static probes) into the fields detect renders into its
 * prompt. No I/O: every input is already in memory when detect runs.
 */

export type DetectResultLine = {
  /** Empty when the SERP entry had only a snippet; the renderer then leads with the snippet. */
  title: string;
  snippet?: string;
  host: string;
  match: "site" | "instagram" | null;
};

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    // A stored owned URL may lack a scheme ("brand.tw"); a SERP link never does.
    if (value.includes("://")) return null;
    try {
      return new URL(`https://${value}`);
    } catch {
      return null;
    }
  }
}

function normalisedPath(url: URL): string {
  return url.pathname.toLowerCase().replace(/\/+$/, "");
}

/**
 * Whether a bare owned host on a shared platform is the platform itself
 * (`pixnet.net`, `shopee.tw`) rather than a brand's own subdomain on it
 * (`brand.pixnet.net`): the platform apex is the host whose parent domain is
 * not itself a shared platform.
 */
function isPlatformApex(bareOwnedHost: string): boolean {
  const parent = bareOwnedHost.slice(bareOwnedHost.indexOf(".") + 1);
  return !isNonBrandSiteHost(`https://${parent}/`);
}

/**
 * Every non-tracking query param on the owned URL must appear on the link
 * with the same value: on a shared host the query can be the identity
 * (`facebook.com/profile.php?id=100`).
 */
function queryMatches(linkUrl: URL, ownedHref: string): boolean {
  const ownedParams = new URL(resultKey(ownedHref)).searchParams;
  for (const [name, value] of ownedParams) {
    if (linkUrl.searchParams.get(name) !== value) return false;
  }
  return true;
}

/**
 * Whether a search-result link belongs to the brand: `'site'` for one of its
 * owned URLs, `'instagram'` for its own Instagram profile, otherwise null.
 *
 * On a shared platform host (pinkoi, shopee, facebook, ...) a host match says
 * nothing about the brand, so the link must also sit under the owned URL's
 * path and carry its non-tracking query params. An owned URL with an empty
 * path on the platform itself never matches — it would claim every store on
 * the platform — but one on a brand subdomain (brand.pixnet.net) matches by
 * host.
 */
export function matchOwnership(
  link: string,
  ownedUrls: readonly string[],
  igHandle: string | null | undefined,
): "site" | "instagram" | null {
  const linkUrl = parseUrl(link);
  if (!linkUrl) return null;
  const linkHref = linkUrl.toString();

  if (hostMatches(linkHref, "instagram.com")) {
    const wanted = igHandle?.trim().replace(/^@/, "").toLowerCase();
    if (!wanted) return null;
    // Query and hash dropped: the profile regex rejects `?hl=en`-style SERP links.
    const handle = extractInstagramHandle(`${linkUrl.origin}${linkUrl.pathname}`);
    return handle?.toLowerCase() === wanted ? "instagram" : null;
  }

  const shared = isNonBrandSiteHost(linkHref);
  const linkPath = normalisedPath(linkUrl);
  // pageKeyHost canonicalises threads.net to threads.com; the link must match it.
  const canonicalLink = canonicalizeThreadsUrl(linkHref);

  for (const owned of ownedUrls) {
    const ownedUrl = parseUrl(owned);
    if (!ownedUrl) continue;
    const ownedHref = ownedUrl.toString();
    const ownedHost = pageKeyHost(ownedHref);
    if (!ownedHost || !hostMatches(canonicalLink, ownedHost)) continue;
    if (!shared) return "site";

    const ownedPath = normalisedPath(ownedUrl);
    if (!ownedPath) {
      // The platform root would claim every store on it; a brand's own
      // subdomain (brand.pixnet.net) is scoped by the host match alone.
      if (isPlatformApex(ownedHost)) continue;
      return "site";
    }
    const underOwnedPath =
      linkPath === ownedPath || linkPath.startsWith(`${ownedPath}/`);
    if (underOwnedPath && queryMatches(linkUrl, ownedHref)) return "site";
  }

  return null;
}

/**
 * Dedupe key for a SERP link. `stripTrackingParams` is gather's key (it drops
 * `srsltid`); `utm_*` is dropped as well so campaign-tagged copies of one page
 * collapse. Other query params stay — `?id=1` and `?id=2` are different pages.
 * `utm_*` stays local rather than moving into the shared `stripTrackingParams`:
 * that helper also keys the links gather stores, which would change too.
 */
function resultKey(link: string): string {
  const stripped = stripTrackingParams(link);
  try {
    const url = new URL(stripped);
    for (const name of [...url.searchParams.keys()]) {
      if (name.toLowerCase().startsWith("utm_")) url.searchParams.delete(name);
    }
    return url.toString();
  } catch {
    return stripped;
  }
}

export function detectResultLines(
  entries: readonly BrandSearchEntry[],
  ownedUrls: readonly string[],
  igHandle: string | null | undefined,
): DetectResultLine[] {
  const seen = new Set<string>();
  const lines: DetectResultLine[] = [];

  for (const entry of entries) {
    if (lines.length >= MAX_RESULT_LINES) break;
    const title = entry.title?.trim() ?? "";
    const snippet = entry.snippet?.trim();
    if (!title && !snippet) continue;
    const url = parseUrl(entry.link);
    if (!url) continue;

    const key = resultKey(entry.link);
    if (seen.has(key)) continue;
    seen.add(key);

    lines.push({
      title,
      ...(snippet ? { snippet } : {}),
      host: pageKeyHost(url.toString()),
      match: matchOwnership(entry.link, ownedUrls, igHandle),
    });
  }

  return lines;
}

/** Whether a probe read any `<head>` text (a non-blank title or description). */
export function hasHeadText(
  probe: Pick<ProbeEvidence, "title" | "description">,
): boolean {
  return Boolean(probe.title?.trim() || probe.description?.trim());
}

/**
 * Whether a probe carries evidence: head text, or a failure (no response, or
 * HTTP 400+). A 2xx/3xx with no head text (an SPA shell) is neither.
 */
export function isUsableProbe(probe: ProbeEvidence): boolean {
  return (
    hasHeadText(probe) || probe.status === undefined || probe.status >= 400
  );
}

/**
 * Probe evidence for the detect prompt — the owner of the probe policy. A
 * failed probe (a 404, a timeout) is kept: "the submitted site is dead" is
 * evidence too. Private URLs and head-less reachable probes are dropped,
 * probes that read a `<head>` come first, and the list is capped.
 */
export function detectProbes(
  evidence: readonly ProbeEvidence[] | undefined,
): ProbeEvidence[] | undefined {
  if (!evidence?.length) return undefined;

  const usable = evidence.filter(
    (probe) => !isPrivateUrl(probe.url) && isUsableProbe(probe),
  );
  const probes = [
    ...usable.filter(hasHeadText),
    ...usable.filter((probe) => !hasHeadText(probe)),
  ].slice(0, MAX_PROBE_URLS);

  return probes.length > 0 ? probes : undefined;
}
