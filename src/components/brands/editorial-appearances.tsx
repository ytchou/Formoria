import { getTranslations } from "next-intl/server";
import { Typography } from "@/components/ui/typography";
import type { AppLocale } from "@/i18n/locale-preference";
import type { TrailLink, StoryLink } from "@/lib/services/editorial-links";
import { routes } from "@/lib/routes";
import {
  RelatedStoryLink,
  RelatedTrailLink,
} from "@/components/stories/related-story-link";

interface EditorialAppearancesProps {
  locale: AppLocale;
  trails: TrailLink[];
  stories: StoryLink[];
  sectionClassName?: string;
}

export async function EditorialAppearances({
  locale,
  trails,
  stories,
  sectionClassName,
}: EditorialAppearancesProps) {
  if (trails.length === 0 && stories.length === 0) return null;

  const t = await getTranslations({ locale, namespace: "brandDetail" });

  return (
    <section className={sectionClassName}>
      <Typography as="h2" variant="sectionTitleLarge">
        {t("editorialAppearances.heading")}
      </Typography>
      <nav
        aria-label={t("editorialAppearances.ariaLabel")}
        className="mt-4 space-y-3"
      >
        {trails.length > 0 && (
          <div>
            <Typography as="h3" variant="subsectionTitle" className="mb-1">
              {t("editorialAppearances.trailPrefix")}
            </Typography>
            <ul className="flex flex-wrap gap-x-4 gap-y-2 type-body-sm">
              {trails.map((trail, index) => (
                <li key={trail.slug}>
                  <RelatedTrailLink
                    href={routes.trail(trail.slug)}
                    trailSlug={trail.slug}
                    position={index}
                    trailSurface="brand-detail"
                    className="text-accent underline underline-offset-4 hover:text-ink"
                  >
                    {trail.title}
                  </RelatedTrailLink>
                </li>
              ))}
            </ul>
          </div>
        )}
        {stories.length > 0 && (
          <div>
            <Typography as="h3" variant="subsectionTitle" className="mb-1">
              {t("editorialAppearances.storyPrefix")}
            </Typography>
            <ul className="flex flex-wrap gap-x-4 gap-y-2 type-body-sm">
              {stories.map((story, index) => (
                <li key={story.slug}>
                  <RelatedStoryLink
                    href={routes.story(story.slug)}
                    storySlug={story.slug}
                    position={index}
                    storySurface="brand-detail"
                    className="text-accent underline underline-offset-4 hover:text-ink"
                  >
                    {story.title}
                  </RelatedStoryLink>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>
    </section>
  );
}
