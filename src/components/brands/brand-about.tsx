import { getTranslations } from "next-intl/server";
import { Typography } from "@/components/ui/typography";
import type { AppLocale } from "@/i18n/locale-preference";
import type { PublicBrandDetail } from "@/lib/brands/contracts";

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
  const paragraphs = description.split("\n\n");

  return (
    <section>
      <Typography as="h2" className="mb-4" variant="sectionTitleLarge">
        {t("sections.about")}
      </Typography>
      {/*
        THE CAP LIVES HERE, not on the route. Nothing between the brand page's
        `page-measure` shell and this column sets a width: with the section nav
        present the body is 4/5 of the page, and without it the whole page, so
        at 100rem these paragraphs ran past 1200px of unbroken line. Every
        other body column on the site is already `prose-measure`.
      */}
      <div className="prose-measure space-y-3">
        {paragraphs.map((paragraph, i) => (
          <p key={i} className="type-body-sm">
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
