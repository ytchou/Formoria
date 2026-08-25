"use client";

import { SurfaceImage } from "@/components/ui/image";
import { Link } from "@/i18n/navigation";
import { trackStoryCardClicked } from "@/lib/analytics";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import { routes } from "@/lib/routes";
import type { StoryEntry } from "@/lib/services/stories";
import { formatStoryDate } from "@/components/stories/story-date";

export type StoryCardProps = {
  story: StoryEntry;
  locale: string;
  position: number;
  trackingSurface?: string;
};

export function StoryCard({
  story,
  locale,
  position,
  trackingSurface,
}: StoryCardProps) {
  const imageSrc = safeImageSrc(story.frontmatter.heroImage);
  const publishedLabel = formatStoryDate(story.frontmatter.publishedAt, locale);

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
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-t-surface bg-surface-deep">
        {imageSrc ? (
          <SurfaceImage
            src={imageSrc}
            alt={story.frontmatter.heroImageAlt ?? ""}
            fill
            className="object-cover transition-transform duration-300 [@media(hover:hover)]:group-hover:scale-[1.03] motion-reduce:duration-[0.01ms]"
            surface="tile"
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
          {[story.frontmatter.tags?.[0], publishedLabel]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <h3 className="font-ming type-card-title mt-2 line-clamp-2 [@media(hover:hover)]:group-hover:text-accent">
          {story.frontmatter.title}
        </h3>
        {story.frontmatter.description ? (
          <p className="type-body-sm text-ink-soft mt-1 line-clamp-2">
            {story.frontmatter.description}
          </p>
        ) : null}
      </div>
    </Link>
  );
}
