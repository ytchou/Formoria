import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import type { StoryEntry } from "@/lib/services/stories";
import { NO_SNIPPET } from "@/lib/seo/snippet";
import { formatStoryDate, toStoryIsoDate } from "./story-date";

export function StoryRow({
  story,
  locale,
  headingLevel,
}: {
  story: StoryEntry;
  locale: string;
  headingLevel: 2 | 3;
}) {
  const t = useTranslations("stories");
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const publishedLabel = formatStoryDate(story.frontmatter.publishedAt, locale);
  const publishedIso = toStoryIsoDate(story.frontmatter.publishedAt);
  // English editions are not authored yet, so /en falls back to the zh-TW set
  // (see resolvePublishedEntries in lib/services/stories.ts). Surfacing that
  // content unlabelled sends an English reader to a page they cannot read.
  const storyLocale = story.frontmatter.locale;
  const isForeignLanguage = storyLocale !== locale;

  return (
    <Link
      href={`/stories/${story.slug}`}
      className="group flex min-h-12 flex-col gap-3 py-5 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex-row md:gap-8 md:py-6"
    >
      {publishedLabel ? (
        <time
          dateTime={publishedIso ?? undefined}
          className="tabular-nums type-metadata md:w-36 md:shrink-0"
        >
          {publishedLabel}
        </time>
      ) : (
        <span aria-hidden="true" className="md:w-36 md:shrink-0" />
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <Heading
          className="type-card-title group-hover:underline"
          lang={isForeignLanguage ? storyLocale : undefined}
        >
          {story.frontmatter.title}
          {isForeignLanguage ? (
            <Badge variant="outline" className="ml-2 align-middle">
              {t("languageBadge")}
            </Badge>
          ) : null}
        </Heading>
        {/*
          Repeated list copy, kept out of Google's snippet selection — see
          NO_SNIPPET. The story's own description still serves snippets from
          /stories/[slug].
        */}
        <p
          {...NO_SNIPPET}
          className="max-w-3xl type-body-muted"
          lang={isForeignLanguage ? storyLocale : undefined}
        >
          {story.frontmatter.description}
        </p>
      </div>
    </Link>
  );
}
