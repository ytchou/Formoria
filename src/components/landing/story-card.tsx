"use client";

import { useTranslations } from "next-intl";

import { SurfaceImage } from "@/components/ui/image";
import { Link } from "@/i18n/navigation";
import { trackStoryCardClicked } from "@/lib/analytics";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import { routes } from "@/lib/routes";
import type { StoryCardEntry } from "@/lib/stories/story-card";
import { cn } from "@/lib/utils";
import { formatStoryDate } from "@/components/stories/story-date";

export type StoryCardProps = {
  story: StoryCardEntry;
  locale: string;
  position: number;
  trackingSurface?: string;
  /**
   * The story's language when it differs from the page's (see
   * `contentLangFor`). Marks the title and excerpt only; the eyebrow is
   * page-locale text.
   */
  contentLang?: string;
  /**
   * `feature` is the /stories hub's lead (EL-14), mirroring the TrailCard
   * feature variant (DESIGN.md §8): a full-width image at 4:3 below md and
   * 21:9 from md, title in `type-section`, description in `type-lede`. The
   * heading stays an h3 so the hub's outline does not change with the variant.
   */
  variant?: "default" | "feature";
};

export function StoryCard({
  story,
  locale,
  position,
  trackingSurface,
  contentLang,
  variant = "default",
}: StoryCardProps) {
  const feature = variant === "feature";
  const t = useTranslations("stories");
  const imageSrc = safeImageSrc(story.frontmatter.heroImage);
  const publishedLabel = formatStoryDate(story.frontmatter.publishedAt, locale);
  // Tags are vocabulary keys (`event`), not display text. Show one only when it
  // has a label; an untranslated key on the card is worse than no tag.
  const tag = story.frontmatter.tags?.[0];
  const tagLabel = tag && t.has(`tags.${tag}`) ? t(`tags.${tag}`) : null;

  return (
    <Link
      href={routes.story(story.slug)}
      className="group flex flex-col rounded-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground"
      data-ph-no-autocapture
      onClick={() =>
        trackStoryCardClicked(
          story.slug,
          position,
          trackingSurface ?? "homepage_latest_stories",
        )
      }
    >
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-t-surface bg-surface-deep",
          feature ? "aspect-[4/3] md:aspect-[21/9]" : "aspect-[4/3]",
        )}
      >
        {imageSrc ? (
          <SurfaceImage
            src={imageSrc}
            alt={story.frontmatter.heroImageAlt ?? ""}
            fill
            // TODO(DEV-2022): import mediaHoverImage / mediaHoverTitle from @/lib/design/media-hover once it merges.
            className="object-cover transition-[scale] duration-300 ease-(--ease-settle) motion-safe:group-hover:scale-[1.03]"
            // The feature spans the hub's page measure, which is exactly the
            // `banner` slot; a grid card is a three-up `tile` cell.
            surface={feature ? "banner" : "tile"}
          />
        ) : (
          <div
            data-fallback
            className="absolute inset-0 bg-surface"
            aria-hidden="true"
          />
        )}
      </div>

      <div className="flex flex-col pt-3">
        <span className="type-eyebrow text-ink-muted">
          {[tagLabel, publishedLabel]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {/* `group-hover` already applies only where hover exists (Tailwind 4). */}
        <h3
          lang={contentLang}
          className={cn(
            "mt-2 font-ming transition-colors duration-150 ease-(--ease-settle) group-hover:text-accent group-active:text-accent",
            feature ? "type-section" : "type-card-title line-clamp-2",
          )}
        >
          {story.frontmatter.title}
        </h3>
        {story.frontmatter.description ? (
          <p
            lang={contentLang}
            className={
              feature
                ? "type-lede mt-2 line-clamp-3"
                : "type-body-sm text-ink-soft mt-1 line-clamp-2"
            }
          >
            {story.frontmatter.description}
          </p>
        ) : null}
      </div>
    </Link>
  );
}
