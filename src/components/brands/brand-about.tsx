import { getTranslations } from "next-intl/server";
import { Typography } from "@/components/ui/typography";
import type { AppLocale } from "@/i18n/locale-preference";
import type { PublicBrandDetail } from "@/lib/brands/contracts";
import { splitLede } from "@/lib/brands/split-lede";

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
  const paragraphs = splitLede(description, locale).rest.split("\n\n");

  // A bare `prose-measure` on this section is an inner reading cap inside the
  // wider page shell (DESIGN.md §4 "Shell or cap"), left-aligned with the page.
  // The id and scroll offset are the section-nav target.
  return (
    <section
      id="about"
      aria-labelledby="about-heading"
      className="prose-measure scroll-mt-40 md:scroll-mt-28"
    >
      <Typography
        as="h2"
        id="about-heading"
        className="mb-4"
        variant="sectionTitleLarge"
      >
        {t("sections.about")}
      </Typography>
      <div className="space-y-3">
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
