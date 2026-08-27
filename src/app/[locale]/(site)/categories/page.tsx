import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { CategoryLinkList } from "@/components/brands/category-link-list";
import { Grid } from "@/components/ui/grid";
import { PageShell } from "@/components/ui/page-shell";
import { routes } from "@/lib/routes";
import { buildAlternates, type Locale } from "@/lib/seo/alternates";
import { listIndexableTargets } from "@/lib/seo/directory-indexation";
import { buildOpenGraph } from "@/lib/seo/open-graph";
import { L1_CATEGORIES, categoryLabel } from "@/lib/taxonomy/ontology";

export const revalidate = 3600;

type CategoriesPageProps = {
  params: Promise<{ locale: string }>;
};

function launchCategories() {
  const launchSlugs = new Set(
    listIndexableTargets()
      .filter((target) => target.pageType === "l1-category")
      .map((target) => target.categorySlug),
  );
  return L1_CATEGORIES.filter((category) => launchSlugs.has(category.slug));
}

export async function generateMetadata({
  params,
}: CategoriesPageProps): Promise<Metadata> {
  const { locale } = await params;
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  setRequestLocale(safeLocale);
  const t = await getTranslations({
    locale: safeLocale,
    namespace: "categories.index",
  });
  const { canonical, languages } = buildAlternates(
    routes.categories(),
    safeLocale,
  );
  const title = t("metadata.title");
  const description = t("metadata.description");

  return {
    title: { absolute: title },
    description,
    alternates: { canonical, languages },
    ...buildOpenGraph({
      title,
      description,
      url: canonical,
      locale: safeLocale === "zh-TW" ? "zh_TW" : "en_US",
      alternateLocale: [safeLocale === "zh-TW" ? "en_US" : "zh_TW"],
    }),
  };
}

export default async function CategoriesPage({ params }: CategoriesPageProps) {
  const { locale } = await params;
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  setRequestLocale(safeLocale);
  const t = await getTranslations({
    locale: safeLocale,
    namespace: "categories",
  });

  return (
    <PageShell as="main" measure="page" className="pt-12 pb-section">
      <header className="prose-measure">
        <h1 className="type-page-title">{t("index.heading")}</h1>
        <p className="mt-4 type-body text-ink-muted">{t("index.intro")}</p>
      </header>

      <Grid cols="pair" className="mt-stack">
        {launchCategories().map((category) => {
          const label = categoryLabel(category, safeLocale);
          const headingId = `category-${category.slug}`;

          return (
            <section
              key={category.slug}
              aria-labelledby={headingId}
              className="rounded-surface border border-rule bg-surface p-6 sm:p-8"
            >
              <h2 id={headingId}>
                <Link
                  href={routes.category(category.slug)}
                  className="inline-flex min-h-12 items-center rounded-control type-card-title transition-colors hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                  {label}
                </Link>
              </h2>
              <p className="mt-3 type-body-sm text-ink-muted">
                {t(`descriptions.${category.slug}`)}
              </p>
              <CategoryLinkList
                locale={safeLocale}
                category={{ slug: category.slug, label }}
                ariaLabel={t("index.childNavigation", { category: label })}
              />
            </section>
          );
        })}
      </Grid>
    </PageShell>
  );
}
