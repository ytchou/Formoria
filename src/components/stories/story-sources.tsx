import { sanitizeHref } from "@/lib/url";

export type StorySourceLink = { href: string; label: string };

/**
 * The reader-facing text for one source: the address as a person would say
 * it, without `https://` or `www.`, and with percent-escapes decoded so a
 * zh-TW path reads as Chinese rather than as `%E5%B7%A5`. The href itself is
 * never decoded — only the text a reader sees.
 *
 * `decodeURI`, not `decodeURIComponent`: an escaped `/` or `?` stays escaped,
 * so the label never shows a path the link does not go to. A malformed escape
 * (a lone `%`) throws, and the raw text is the honest fallback.
 */
function sourceLinkLabel(href: string): string {
  const bare = href.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  try {
    return decodeURI(bare);
  } catch {
    return bare;
  }
}

/**
 * Frontmatter `sources` as outbound links, safe ones only. `sanitizeHref` is
 * the project's one href gate (it refuses `javascript:` and every other
 * non-http scheme); the `URL` parse on top drops an entry that only looks like
 * an address — free text the gate would otherwise prefix with `https://`.
 */
export function storySourceLinks(sources: string[]): StorySourceLink[] {
  return sources.flatMap((source) => {
    const href = sanitizeHref(source);
    if (!href) return [];
    try {
      const url = new URL(href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return [];
    } catch {
      return [];
    }
    return [{ href, label: sourceLinkLabel(href) }];
  });
}

/**
 * 參考資料 — the source list a story's facts come from (CP-17). Facts come only
 * from `pnpm story:facts` or a URL in `sources`, so the URLs are the reader's
 * way to check the story's claims; the FAQ already promises this list.
 *
 * Numbered, because a reader cites "the third source", and outbound with the
 * same `target`/`rel` every other external link on the site carries. A long
 * address wraps anywhere rather than pushing the prose column sideways.
 * Nothing at all for an empty list: an empty heading reads as an omission.
 */
export function StorySources({
  heading,
  sources,
}: {
  /** `stories.sourcesHeading`, in the page's language. */
  heading: string;
  sources: string[];
}) {
  const links = storySourceLinks(sources);
  if (links.length === 0) return null;

  return (
    <section aria-labelledby="story-sources" className="space-y-3">
      <h2 id="story-sources" className="type-card-title">
        {heading}
      </h2>
      <ol className="list-decimal space-y-2 pl-6 type-body-sm">
        {links.map((link, index) => (
          <li key={`${link.href}-${index}`}>
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline underline-offset-4 [overflow-wrap:anywhere] hover:text-ink"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
