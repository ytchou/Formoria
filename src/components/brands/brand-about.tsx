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
      <Typography as="h2" className="mb-4" variant="sectionTitle">
        {t("sections.about")}
      </Typography>
      <div className="space-y-3">
        {paragraphs.map((paragraph, i) => (
          <p key={i} className="type-section-description">
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
