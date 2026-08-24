import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CRAWLER_REGISTRY,
  robotsTokenFor,
} from "@/lib/security/crawler-registry";
import { CONTENT_SIGNAL } from "./robots-content";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

interface ParsedGroup {
  allow: string[];
  disallow: string[];
  contentSignal?: string;
}

/**
 * Parses the served body into groups keyed by user-agent so every assertion
 * below looks a rule up by name. Positional indexing would silently pass when
 * the registry reorders.
 */
function parseGroups(body: string): Map<string, ParsedGroup> {
  const groups = new Map<string, ParsedGroup>();
  let current: ParsedGroup | null = null;

  for (const line of body.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (key === "user-agent") {
      current = { allow: [], disallow: [] };
      groups.set(value, current);
      continue;
    }

    if (!current) continue;
    if (key === "allow") current.allow.push(value);
    if (key === "disallow") current.disallow.push(value);
    if (key === "content-signal") current.contentSignal = value;
  }

  return groups;
}

async function getBody(): Promise<string> {
  const response = await GET();
  expect(response.headers.get("content-type")).toBe(
    "text/plain; charset=utf-8",
  );
  return response.text();
}

describe("GET /robots.txt", () => {
  it("wildcard rule is found by userAgent, not by index", async () => {
    const groups = parseGroups(await getBody());
    expect(groups.get("*")?.allow).toContain("/");
  });

  it("wildcard rule still disallows admin, api and auth paths", async () => {
    const groups = parseGroups(await getBody());
    expect(groups.get("*")?.disallow).toEqual(
      expect.arrayContaining(["/admin", "/api/", "/auth/", "/en/auth/"]),
    );
  });

  it("wildcard rule still allows /submit", async () => {
    const body = await getBody();
    expect(parseGroups(body).get("*")?.disallow).not.toContain("/submit");
    expect(body).not.toMatch(/Disallow:\s*\/submit\b/);
  });

  it("disallows /challenge", async () => {
    const groups = parseGroups(await getBody());
    expect(groups.get("*")?.disallow).toContain("/challenge");
  });

  // RFC 9309 section 2.2.1: a crawler obeys only its most specific matching group
  // and never merges it with the wildcard group, so each per-agent group has to
  // repeat the wildcard disallow list verbatim.
  it("emits a per-agent group carrying the full wildcard disallow list", async () => {
    const groups = parseGroups(await getBody());
    const wildcardDisallow = groups.get("*")?.disallow ?? [];
    expect(wildcardDisallow).toContain("/challenge");

    for (const entry of CRAWLER_REGISTRY) {
      expect(groups.get(robotsTokenFor(entry))).toEqual({
        allow: ["/"],
        disallow: wildcardDisallow,
        contentSignal: CONTENT_SIGNAL,
      });
    }
  });

  it("declares ai-train=no while allowing search", async () => {
    expect(CONTENT_SIGNAL).toBe("ai-train=no, search=yes, ai-input=yes");
    const groups = parseGroups(await getBody());
    expect(groups.get("*")?.contentSignal).toBe(CONTENT_SIGNAL);
  });

  // The published Terms cite /robots.txt as the authority for declining AI
  // training, so the signal has to reach the AI-training crawlers' own groups --
  // a wildcard-only directive would leave that claim unbacked.
  it("attaches Content-Signal to every ai-training group, GPTBot included", async () => {
    const groups = parseGroups(await getBody());
    expect(groups.get("GPTBot")?.contentSignal).toBe(CONTENT_SIGNAL);

    for (const entry of CRAWLER_REGISTRY.filter(
      ({ purpose }) => purpose === "ai-training",
    )) {
      expect(groups.get(robotsTokenFor(entry))?.contentSignal).toBe(
        CONTENT_SIGNAL,
      );
    }
  });

  it("emits the Content-Signal directive in the body", async () => {
    const body = await getBody();
    expect(body).toContain(
      "Content-Signal: ai-train=no, search=yes, ai-input=yes",
    );
  });

  it("references sitemap.xml", async () => {
    const body = await getBody();
    expect(body).toMatch(/^Sitemap: \S+\/sitemap\.xml$/m);
  });

  it("never blocks the whole site", async () => {
    const body = await getBody();
    expect(body).not.toMatch(/Disallow: \/$|Disallow: \*$/m);
  });

  it("blocks every crawler and omits the sitemap in staging", async () => {
    vi.stubEnv("FORMORIA_DEPLOYMENT_ENV", "staging");

    const body = await getBody();
    expect(body).toContain("User-Agent: *");
    expect(body).toContain("Disallow: /");
    expect(body).not.toContain("Sitemap:");
  });
});

/**
 * DEV-1551. `crawler-registry.ts` is the single source of truth for BOTH the
 * runtime edge policy and the published robots.txt, so a change made for
 * rate-limiting reasons silently rewrites what search engines are told. The
 * frozen list below is the review gate: touching the registry fails this test,
 * and the failure is the prompt to decide whether robots.txt should change too.
 *
 * A frozen list of tokens rather than a whole-body snapshot: the body embeds
 * `getSiteUrl()`, which is environment-dependent.
 */
const FROZEN_ROBOTS_TOKENS = [
  "*",
  "Googlebot-Image",
  "Google-InspectionTool",
  "AdsBot-Google",
  "Applebot-Extended",
  "Google-Extended",
  "Claude-SearchBot",
  "Meta-ExternalAgent",
  "Threadsbot",
  "Meta-ExternalFetcher",
  "facebookexternalhit",
  "LinkedInBot",
  "Twitterbot",
  "Slackbot",
  "Discordbot",
  "WhatsApp",
  "Linespider",
  "Googlebot",
  "Bingbot",
  "Applebot",
  "DuckDuckBot",
  "YandexBot",
  "Slurp",
  "GPTBot",
  "ChatGPT-User",
  "PerplexityBot",
  "ClaudeBot",
  "Bytespider",
  "Amazonbot",
  "CCBot",
  "Diffbot",
  "cohere-ai",
  "Timpibot",
  "YouBot",
];

const FROZEN_GROUP_BODY = [
  "Content-Signal: ai-train=no, search=yes, ai-input=yes",
  "Allow: /",
  "Disallow: /admin",
  "Disallow: /api/",
  "Disallow: /auth/",
  "Disallow: /en/auth/",
  "Disallow: /challenge",
].join("\n");

describe("robots.txt output is unchanged by the registry change", () => {
  it("serves the same User-Agent groups, in the same order", async () => {
    const body = await getBody();
    const tokens = [...body.matchAll(/^User-Agent: (.+)$/gm)].map(
      (match) => match[1],
    );

    expect(tokens).toEqual(FROZEN_ROBOTS_TOKENS);
  });

  it("serves the same directive block for every group", async () => {
    const body = await getBody();
    const groups = body
      .split("\n\n")
      .filter((block) => block.startsWith("User-Agent: "));

    expect(groups).toHaveLength(FROZEN_ROBOTS_TOKENS.length);
    for (const group of groups) {
      const [header, ...rest] = group.split("\n");
      expect(header).toMatch(/^User-Agent: /);
      expect(rest.join("\n")).toBe(FROZEN_GROUP_BODY);
    }
  });
});
