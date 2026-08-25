import { getTranslations } from "next-intl/server";
import { Typography } from "@/components/ui/typography";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/locale-preference";
import type { TrailLink, StoryLink } from "@/lib/services/editorial-links";
import { routes } from "@/lib/routes";

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
          <ul className="flex flex-wrap gap-x-4 gap-y-2 type-body-sm">
            {trails.map((trail) => (
              <li key={trail.slug}>
                <Link
                  href={routes.trail(trail.slug)}
                  className="text-accent underline underline-offset-4 hover:text-ink"
                >
                  {trail.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {stories.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-2 type-body-sm">
            {stories.map((story) => (
              <li key={story.slug}>
                <Link
                  href={routes.story(story.slug)}
                  className="text-accent underline underline-offset-4 hover:text-ink"
                >
                  {story.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </section>
  );
}
