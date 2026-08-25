import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localizePath } from "@/i18n/locale-preference";
import { routes } from "@/lib/routes";
import { DirectoryView } from "@/components/brands/directory-view";
import { L1_CATEGORIES, categoryLabel, isVisibleCategory } from "@/lib/taxonomy/ontology";
import {
  parseDirectoryViewFilters,
  type DirectorySearchParams,
} from "@/lib/seo/directory-filters";
import { resolveDirectorySeo } from "@/lib/seo/directory-indexation";
import { buildDirectoryCanonicals } from "@/lib/seo/directory-canonical";
import { buildOpenGraph } from "@/lib/seo/open-graph";
import { truncateForMeta } from "@/lib/text/truncate-for-meta";
import type { Locale } from "@/lib/seo/alternates";
import { resolveCategoryRouteParams } from "../category-params";

export const revalidate = 3600;

type CategoryPageProps = {
  params: Promise<{ locale: string; category: string }>;
  searchParams: Promise<DirectorySearchParams>;
};

export async function generateMetadata({
  params,
  searchParams,
}: CategoryPageProps): Promise<Metadata> {
  const { locale, category: categorySlug } = await params;
  const resolved = resolveCategoryRouteParams({ categorySlug });
  if (!resolved) return {};
  if (!isVisibleCategory(resolved.category.slug)) return {};
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const sp = await searchParams;
  const { page, sort } = parseDirectoryViewFilters(
    sp,
    new Set(L1_CATEGORIES.map((category) => category.slug)),
  );
  const seo = resolveDirectorySeo({
    locale: safeLocale,
    surface: "category",
    categorySlug: resolved.category.slug,
    page,
    facets: {
      search: sp.search,
      verification: sp.verification,
      sort:
        typeof sp.sort === "string"
          ? sp.sort
          : sort !== "random"
            ? sort
            : undefined,
      category: sp.category,
      sub: sp.sub,
      material: sp.material,
    },
  });
  const catT = await getTranslations({
    locale: safeLocale,
    namespace: "categories",
  });
  const displayName = categoryLabel(resolved.category, safeLocale);
  const landingKey = `l1.${resolved.category.slug}`;
  const title = catT.has(`${landingKey}.title`)
    ? catT(`${landingKey}.title`)
    : catT("metadata.title", { displayName });
  const description = truncateForMeta(
    catT.has(`${landingKey}.description`)
      ? catT(`${landingKey}.description`)
      : catT.has(`descriptions.${resolved.category.slug}`)
        ? catT(`descriptions.${resolved.category.slug}`)
        : catT("metadata.description", {
            displayName,
            name: resolved.category.name,
          }),
  );
  const canonical =
    seo.canonical ||
    buildDirectoryCanonicals({
      locale: safeLocale,
      categorySlug: resolved.category.slug,
      page,
    }).canonical;
  const languages = seo.languages;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical, ...(languages ? { languages } : {}) },
    ...(seo.robots ? { robots: seo.robots } : {}),
    ...buildOpenGraph({
      title,
      description,
      url: canonical,
      locale: safeLocale === "zh-TW" ? "zh_TW" : "en_US",
      alternateLocale: [safeLocale === "zh-TW" ? "en_US" : "zh_TW"],
    }),
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: CategoryPageProps) {
  const { locale, category: categorySlug } = await params;
  const resolved = resolveCategoryRouteParams({ categorySlug });
  if (!resolved) notFound();
  if (!isVisibleCategory(resolved.category.slug)) redirect(localizePath(routes.brands(), locale));
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const sp = await searchParams;
  const parsed = parseDirectoryViewFilters(
    sp,
    new Set(L1_CATEGORIES.map((category) => category.slug)),
  );
  const directorySeo = resolveDirectorySeo({
    locale: safeLocale,
    surface: "category",
    categorySlug: resolved.category.slug,
    page: parsed.page,
    facets: {
      search: sp.search,
      verification: sp.verification,
      sort:
        typeof sp.sort === "string"
          ? sp.sort
          : parsed.sort !== "random"
            ? parsed.sort
            : undefined,
      category: sp.category,
      sub: sp.sub,
      material: sp.material,
    },
  });
  return (
    <DirectoryView
      locale={safeLocale}
      filters={{
        ...parsed.filters,
        categorySlugs: [resolved.category.slug],
        subcategorySlugs: [],
      }}
      page={parsed.page}
      sort={parsed.sort}
      canonical={directorySeo.canonical}
      indexable={directorySeo.robots?.index !== false}
      isCategoryRoute
    />
  );
}
