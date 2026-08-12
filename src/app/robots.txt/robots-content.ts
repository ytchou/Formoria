import {
  CRAWLER_REGISTRY,
  robotsTokenFor,
} from "@/lib/security/crawler-registry";
import { isStagingEnvironment } from "@/lib/deployment-environment";

/**
 * Declares that AI training is disallowed while search indexing and answer-time
 * AI input stay allowed. The published Terms cite /robots.txt as the
 * machine-readable authority for this stance, so the line has to be served, not
 * merely declared. Next's metadata serializer (`MetadataRoute.Robots`) can only
 * emit User-Agent/Allow/Disallow/Crawl-delay/Host/Sitemap, which is why this
 * file is rendered by a text/plain Route Handler instead.
 */
export const CONTENT_SIGNAL = "ai-train=no, search=yes, ai-input=yes";

/**
 * Surfaces that stay out of every crawler's index. /submit is deliberately
 * absent: the submission funnel is a public entry point and must remain
 * crawlable.
 */
const WILDCARD_DISALLOW = [
  "/admin",
  "/api/",
  "/auth/",
  "/en/auth/",
  "/challenge",
] as const;

interface RobotsRule {
  userAgent: string;
  allow?: string;
  disallow?: readonly string[];
  contentSignal?: string;
}

export interface RobotsDocument {
  rules: readonly RobotsRule[];
  host: string;
  sitemap?: string;
}

export function buildRobotsDocument(siteUrl: string): RobotsDocument {
  if (isStagingEnvironment()) {
    return {
      rules: [{ userAgent: "*", disallow: ["/"] }],
      host: siteUrl,
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        contentSignal: CONTENT_SIGNAL,
        allow: "/",
        disallow: WILDCARD_DISALLOW,
      },
      // One declarative group per registry entry so the allow/block matrix in
      // crawler-registry.ts stays the single source of truth for both the
      // runtime edge policy and the published robots.txt.
      //
      // Per RFC 9309 section 2.2.1 a crawler obeys only the single most specific
      // matching group and never merges it with `User-Agent: *`, so each group has
      // to repeat the wildcard disallow list and the Content-Signal directive in
      // full. Omitting either would let every registry crawler reach /admin and the
      // noindex /challenge page, and would hide `ai-train=no` from the AI-training
      // crawlers it addresses.
      ...CRAWLER_REGISTRY.map((entry) => ({
        userAgent: robotsTokenFor(entry),
        contentSignal: CONTENT_SIGNAL,
        allow: "/",
        disallow: WILDCARD_DISALLOW,
      })),
    ],
    host: siteUrl,
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}

export function formatRobotsTxt({
  rules,
  host,
  sitemap,
}: RobotsDocument): string {
  const groups = rules.map((rule) => {
    const lines = [`User-Agent: ${rule.userAgent}`];

    if (rule.contentSignal) {
      lines.push(`Content-Signal: ${rule.contentSignal}`);
    }

    if (rule.allow) {
      lines.push(`Allow: ${rule.allow}`);
    }

    for (const path of rule.disallow ?? []) {
      lines.push(`Disallow: ${path}`);
    }

    return lines.join("\n");
  });

  const directives = [...groups, `Host: ${host}`];
  if (sitemap) {
    directives.push(`Sitemap: ${sitemap}`);
  }
  return `${directives.join("\n\n")}\n`;
}
