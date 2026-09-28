import { isPrivateUrl } from "@/lib/url";
// Runtime import is safe: category-classifier only type-imports this module.
import { MAX_PROBE_URLS } from "../category-classifier";
import type { ProbeEvidence } from "./gather";
import { isNonBrandSiteHost } from "./scraper/input-detector";
import { extractInstagramHandle } from "./scraper/parse/extractors";
import { stripTrackingParams } from "./scraper/search";
import type { BrandSearchEntry } from "./scraper/types";

/**
 * Pure projections from gather's in-memory evidence (SERP entries, the
 * brand's owned URLs, static probes) into the fields detect renders into its
 * prompt. No I/O: every input is already in memory when detect runs.
 */

export type DetectResultLine = {
  title: string;
  snippet?: string;
  host: string;
  match: "site" | "instagram" | null;
};

export type DetectProbe = {
  url: string;
  title?: string;
  description?: string;
  platform?: string;
  status?: number;
  instagramFollowers?: number;
};

const MAX_RESULT_LINES = 10;

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

function bareHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function hostCovers(linkHost: string, ownedHost: string): boolean {
  return linkHost === ownedHost || linkHost.endsWith(`.${ownedHost}`);
}

function normalisedPath(url: URL): string {
  return url.pathname.toLowerCase().replace(/\/+$/, "");
}

function isInstagramHost(host: string): boolean {
  return hostCovers(host, "instagram.com");
}

/**
 * Whether a search-result link belongs to the brand: `'site'` for one of its
 * owned URLs, `'instagram'` for its own Instagram profile, otherwise null.
 *
 * On a shared platform host (pinkoi, shopee, facebook, ...) a host match says
 * nothing about the brand, so the link must also sit under the owned URL's
 * path. An owned URL with an empty path on such a host never matches — it
 * would claim every store on the platform.
 */
export function matchOwnership(
  link: string,
  ownedUrls: readonly string[],
  igHandle: string | null | undefined,
): "site" | "instagram" | null {
  const linkUrl = parseUrl(link);
  if (!linkUrl) return null;
  const linkHost = bareHost(linkUrl);

  if (isInstagramHost(linkHost)) {
    const wanted = igHandle?.trim().replace(/^@/, "").toLowerCase();
    if (!wanted) return null;
    // Query and hash dropped: the profile regex rejects `?hl=en`-style SERP links.
    const handle = extractInstagramHandle(`${linkUrl.origin}${linkUrl.pathname}`);
    return handle?.toLowerCase() === wanted ? "instagram" : null;
  }

  const shared = isNonBrandSiteHost(linkUrl.toString());
  const linkPath = normalisedPath(linkUrl);

  for (const owned of ownedUrls) {
    const ownedUrl = parseUrl(owned);
    if (!ownedUrl) continue;
    if (!hostCovers(linkHost, bareHost(ownedUrl))) continue;
    if (!shared) return "site";

    const ownedPath = normalisedPath(ownedUrl);
    if (!ownedPath) continue;
    if (linkPath === ownedPath || linkPath.startsWith(`${ownedPath}/`)) {
      return "site";
    }
  }

  return null;
}

/**
 * Dedupe key for a SERP link. `stripTrackingParams` is gather's key (it drops
 * `srsltid`); `utm_*` is dropped as well so campaign-tagged copies of one page
 * collapse. Other query params stay — `?id=1` and `?id=2` are different pages.
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

export function detectResults(
  entries: readonly BrandSearchEntry[],
  ownedUrls: readonly string[],
  igHandle: string | null | undefined,
): DetectResultLine[] {
  const seen = new Set<string>();
  const lines: DetectResultLine[] = [];

  for (const entry of entries) {
    if (lines.length >= MAX_RESULT_LINES) break;
    const title = entry.title?.trim();
    if (!title) continue;
    const url = parseUrl(entry.link);
    if (!url) continue;

    const key = resultKey(entry.link);
    if (seen.has(key)) continue;
    seen.add(key);

    const snippet = entry.snippet?.trim();
    lines.push({
      title,
      ...(snippet ? { snippet } : {}),
      host: bareHost(url),
      match: matchOwnership(entry.link, ownedUrls, igHandle),
    });
  }

  return lines;
}

function hasHead(probe: ProbeEvidence): boolean {
  return Boolean(probe.title?.trim() || probe.description?.trim());
}

/**
 * Probe evidence for the detect prompt. A failed probe (a 404, a timeout) is
 * kept: "the submitted site is dead" is evidence too. Private URLs are
 * dropped, probes that read a `<head>` come first, and the list is capped.
 */
export function detectProbes(
  evidence: readonly ProbeEvidence[] | undefined,
): DetectProbe[] | undefined {
  if (!evidence?.length) return undefined;

  const publicProbes = evidence.filter((probe) => !isPrivateUrl(probe.url));
  const ordered = [
    ...publicProbes.filter(hasHead),
    ...publicProbes.filter((probe) => !hasHead(probe)),
  ];

  const probes = ordered.slice(0, MAX_PROBE_URLS).map((probe) => ({
    url: probe.url,
    ...(probe.title ? { title: probe.title } : {}),
    ...(probe.description ? { description: probe.description } : {}),
    ...(probe.platform ? { platform: probe.platform } : {}),
    ...(probe.status !== undefined ? { status: probe.status } : {}),
    ...(probe.instagramFollowers !== undefined
      ? { instagramFollowers: probe.instagramFollowers }
      : {}),
  }));

  return probes.length > 0 ? probes : undefined;
}
