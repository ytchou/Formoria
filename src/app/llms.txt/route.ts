import { getSiteUrl } from "@/lib/seo/site-url";

export const revalidate = 3600;

export async function GET() {
  const base = getSiteUrl();

  const links = [
    `- [Brands](${base}/brands)`,
    `- [About](${base}/about)`,
    `- [Mission and Vision](${base}/vision)`,
    `- [Glossary](${base}/glossary)`,
  ];

  const body = [
    "# Formoria",
    "",
    "Formoria is a Taiwanese brand discovery and curation platform built to make Taiwanese brands easier to discover, choose, and grow. Its searchable, community-built directory is the foundation of that mission.",
    "",
    "## Links",
    ...links,
    "",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
