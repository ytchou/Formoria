import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { SurfaceCard } from "@/components/ui/card";
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
      <SurfaceCard
        padding="lg"
        className="grid gap-6 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:gap-gutter"
      >
        <Typography as="h2" variant="sectionTitle">
          {t("editorialAppearances.heading")}
        </Typography>
        <nav
          aria-label={t("editorialAppearances.ariaLabel")}
          className="space-y-5"
        >
          {trails.length > 0 && (
            <div>
              <Typography as="h3" variant="metadata" className="mb-2">
                {t("editorialAppearances.trailPrefix")}
              </Typography>
              <ul className="divide-y divide-rule border-y border-rule">
                {trails.map((trail, index) => (
                  <li key={trail.slug}>
                    <RelatedTrailLink
                      href={routes.trail(trail.slug)}
                      trailSlug={trail.slug}
                      position={index}
                      trailSurface="brand-detail"
                      className="flex min-h-12 items-center justify-between gap-4 px-2 py-3 text-accent hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                    >
                      <Typography as="span" variant="cardTitle">
                        {trail.title}
                      </Typography>
                      <ArrowRight
                        aria-hidden="true"
                        className="size-5 shrink-0"
                      />
                    </RelatedTrailLink>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {stories.length > 0 && (
            <div>
              <Typography as="h3" variant="metadata" className="mb-2">
                {t("editorialAppearances.storyPrefix")}
              </Typography>
              <ul className="divide-y divide-rule border-y border-rule">
                {stories.map((story, index) => (
                  <li key={story.slug}>
                    <RelatedStoryLink
                      href={routes.story(story.slug)}
                      storySlug={story.slug}
                      position={index}
                      storySurface="brand-detail"
                      className="flex min-h-12 items-center justify-between gap-4 px-2 py-3 text-accent hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                    >
                      <Typography as="span" variant="cardTitle">
                        {story.title}
                      </Typography>
                      <ArrowRight
                        aria-hidden="true"
                        className="size-5 shrink-0"
                      />
                    </RelatedStoryLink>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </nav>
      </SurfaceCard>
    </section>
  );
}
