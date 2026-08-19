import fs from "fs";
import path from "path";

import matter from "gray-matter";

export type PublishedTrail = {
  slug: string;
  title: string;
  locale: string;
  /**
   * Raw frontmatter value, read the way `readTrailEntry` reads it
   * (src/lib/services/trails.ts:139) so a non-string authored value lands here
   * exactly as it lands in the app.
   *
   * NOT pre-trimmed: the wall's eligibility gate treats a blank string as
   * absent (`eligibleTrail`, src/lib/curated-products/home-wall.ts:177), so a
   * reader must apply `.trim()` rather than a bare truthiness check.
   */
  heroImage?: string;
  sections: Array<{ key: string; title: string }>;
};

const TRAILS_DIR = path.join(process.cwd(), "content", "trails");

/**
 * Mirrors the public content gate in the trail loader. Sorting by filename keeps
 * selection deterministic instead of inheriting filesystem directory order.
 */
export function publishedTrails(locale = "zh-TW"): PublishedTrail[] {
  let files: string[];
  try {
    files = fs
      .readdirSync(TRAILS_DIR)
      .filter((file) => file.endsWith(".mdx"))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }

  return files.flatMap((file) => {
    const slug = file.replace(/\.mdx$/, "");
    const { data } = matter(
      fs.readFileSync(path.join(TRAILS_DIR, file), "utf8"),
    );
    const authoredLocale = data.locale ?? "zh-TW";
    if (data.draft === true || authoredLocale !== locale) return [];

    const sections = Array.isArray(data.sections)
      ? data.sections.flatMap((section: unknown) => {
          if (
            typeof section !== "object" ||
            section === null ||
            typeof (section as { key?: unknown }).key !== "string" ||
            typeof (section as { title?: unknown }).title !== "string"
          ) {
            return [];
          }
          return [
            {
              key: (section as { key: string }).key,
              title: (section as { title: string }).title,
            },
          ];
        })
      : [];

    return [
      {
        slug,
        title: data.title ?? "",
        locale: authoredLocale,
        heroImage: data.heroImage == null ? undefined : String(data.heroImage),
        sections,
      },
    ];
  });
}

export const NO_PUBLISHED_TRAILS = "no published trails in content/trails";
