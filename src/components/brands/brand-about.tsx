import { getTranslations } from "next-intl/server";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";
import type { AppLocale } from "@/i18n/locale-preference";
import type { PublicBrandDetail } from "@/lib/brands/contracts";
import { splitLede } from "@/lib/brands/split-lede";

/**
 * Story length (characters) from which the band sets in two columns at lg.
 * Below it a single 48rem column is at most about three lines and the blank
 * beside it is small; above it a lone column left x≈840–1376 empty at 1440
 * beside the story (BD2-04). Latin runs ~2.5× the characters per line.
 */
const TWO_COLUMN_MIN_CHARS: Record<AppLocale, number> = {
  "zh-TW": 140,
  en: 350,
};

interface BrandAboutProps {
  brand: PublicBrandDetail;
  locale: AppLocale;
}

export async function BrandAbout({ brand, locale }: BrandAboutProps) {
  const description =
    locale === "en"
      ? (brand.descriptionEn ?? brand.description)
      : brand.description;

  if (!description) return null;

  const t = await getTranslations({ locale, namespace: "brandDetail" });
  // The first sentence is the hero lede (BrandHeader); the story starts after
  // it, so the sentence is never printed twice.
  const rest = splitLede(description, locale).rest;
  const paragraphs = rest.split("\n\n");
  const twoColumn = rest.length >= TWO_COLUMN_MIN_CHARS[locale];

  // A bare `prose-measure` on this section is an inner reading cap inside the
  // wider page shell (DESIGN.md §4 "Shell or cap"), left-aligned with the page.
  // The id and scroll offset are the section-nav target. A long story drops
  // the cap at lg and sets in two columns across the page instead, each
  // column still narrower than the measure; DOM order is unchanged.
  return (
    <section
      id="about"
      aria-labelledby="about-heading"
      className={cn(
        "prose-measure scroll-mt-40 md:scroll-mt-28",
        twoColumn && "lg:max-w-none",
      )}
    >
      <Typography
        as="h2"
        id="about-heading"
        className="mb-4"
        variant="sectionTitleLarge"
      >
        {t("sections.about")}
      </Typography>
      <div
        className={cn("space-y-3", twoColumn && "lg:columns-2 lg:gap-x-gutter")}
      >
        {paragraphs.map((paragraph, i) => (
          <p key={i} className="type-body">
            {paragraph.split("\n").map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {line}
              </span>
            ))}
          </p>
        ))}
      </div>
    </section>
  );
}
