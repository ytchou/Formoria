import { describe, expect, it } from "vitest";

import { CRAWLER_REGISTRY } from "@/lib/security/crawler-registry";
import { CONTENT_SIGNAL } from "./robots-content";
import { GET } from "./route";

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

  it("emits a per-agent group for every registry entry", async () => {
    const groups = parseGroups(await getBody());
    for (const entry of CRAWLER_REGISTRY) {
      expect(groups.get(entry.name)).toEqual({
        allow: ["/"],
        disallow: [],
      });
    }
  });

  it("declares ai-train=no while allowing search", async () => {
    expect(CONTENT_SIGNAL).toBe("ai-train=no, search=yes, ai-input=yes");
    const groups = parseGroups(await getBody());
    expect(groups.get("*")?.contentSignal).toBe(CONTENT_SIGNAL);
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
});
