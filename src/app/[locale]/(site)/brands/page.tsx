import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DirectoryView } from "@/components/brands/directory-view";
import {
  L1_CATEGORIES,
  VISIBLE_L1_CATEGORIES,
  categoryLabel,
  resolveDirectorySubcategorySlugs,
} from "@/lib/taxonomy/ontology";
import {
  hasDeferredCategoryFilter,
  hasInvalidCategoryFilter,
  parseDirectoryViewFilters,
  type DirectorySearchParams,
} from "@/lib/seo/directory-filters";
import type { Locale } from "@/lib/seo/alternates";
import { buildPageMetadata } from "@/lib/seo/page-metadata";
import { resolveDirectorySeo } from "@/lib/seo/directory-indexation";
import { truncateForMeta } from "@/lib/text/truncate-for-meta";

// Both `generateMetadata` and the page body read `searchParams`, which opts this route
// into dynamic rendering. Keep this value for path revalidation parity.
export const revalidate = 3600;

const VALID_CATEGORY_SLUGS = new Set(
  VISIBLE_L1_CATEGORIES.map((category) => category.slug),
);

interface BrandsPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<DirectorySearchParams>;
}

export async function generateMetadata({
  params,
  searchParams,
}: BrandsPageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const sp = await searchParams;
  if (hasDeferredCategoryFilter(sp.category)) notFound();
  // An unknown category 404s like `/discover?category=` does (DS-34) rather
  // than serving every brand under a URL that names a category.
  if (hasInvalidCategoryFilter(sp.category, VALID_CATEGORY_SLUGS)) notFound();
  const { filters, page } = parseDirectoryViewFilters(sp, VALID_CATEGORY_SLUGS);
  const categorySlug =
    filters.categorySlugs.length === 1
      ? (filters.categorySlugs[0] ?? null)
      : null;
  const category = categorySlug
    ? L1_CATEGORIES.find((item) => item.slug === categorySlug)
    : undefined;
  // No parent-L1 conjunct: `?category=fashion&sub=backpacks` must name the sub
  // it is actually filtering by. `resolveDirectorySeo` still treats the
  // cross-L1 pair as invalid, so the canonical stays `/brands?category=&sub=`
  // and never points at the 404 that `/categories/fashion/backpacks` is.
  const subcategory = resolveDirectorySubcategorySlugs(
    filters.subcategorySlugs,
  );
  const activeSubcategory =
    subcategory.length === 1 ? subcategory[0] : undefined;
  const seo = resolveDirectorySeo({
    locale: safeLocale,
    surface: "brands",
    categorySlug: categorySlug,
    subcategorySlug: activeSubcategory?.slug,
    page,
    facets: {
      search: sp.search,
      sort: typeof sp.sort === "string" ? sp.sort : undefined,
      category: sp.category,
      sub: sp.sub,
      multiCategory: filters.categorySlugs.length > 1,
      multiSub: filters.subcategorySlugs.length > 1,
    },
  });

  if (category) {
    const catT = await getTranslations({
      locale: safeLocale,
      namespace: "categories",
    });
    const displayName = categoryLabel(category, safeLocale);
    const subName = activeSubcategory
      ? safeLocale === "zh-TW"
        ? activeSubcategory.nameZh
        : activeSubcategory.nameEn
      : undefined;
    const landingKey = activeSubcategory
      ? `l2.${activeSubcategory.slug}`
      : `l1.${category.slug}`;
    const description = truncateForMeta(
      subName
        ? catT.has(`${landingKey}.description`)
          ? catT(`${landingKey}.description`)
          : catT("subMetadata.description", {
              subName,
              categoryName: displayName,
            })
        : catT.has(`${landingKey}.description`)
          ? catT(`${landingKey}.description`)
          : catT.has(`descriptions.${category.slug}`)
            ? catT(`descriptions.${category.slug}`)
            : catT("metadata.description", {
                displayName,
                name: category.name,
              }),
    );
    const title = subName
      ? catT.has(`${landingKey}.title`)
        ? catT(`${landingKey}.title`)
        : catT("subMetadata.title", { subName, categoryName: displayName })
      : catT.has(`${landingKey}.title`)
        ? catT(`${landingKey}.title`)
        : catT("metadata.title", { displayName });

    return buildPageMetadata({
      locale: safeLocale,
      title,
      description,
      absoluteTitle: true,
      alternates: { canonical: seo.canonical, languages: seo.languages },
      robots: seo.robots,
    });
  }

  const brandsT = await getTranslations({
    locale: safeLocale,
    namespace: "brands",
  });
  return buildPageMetadata({
    locale: safeLocale,
    title: brandsT("metadata.title"),
    description: brandsT("metadata.description"),
    absoluteTitle: true,
    alternates: { canonical: seo.canonical, languages: seo.languages },
    robots: seo.robots,
  });
}

export default async function BrandsPage({
  params,
  searchParams,
}: BrandsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const sp = await searchParams;
  if (hasDeferredCategoryFilter(sp.category)) notFound();
  // An unknown category 404s like `/discover?category=` does (DS-34) rather
  // than serving every brand under a URL that names a category.
  if (hasInvalidCategoryFilter(sp.category, VALID_CATEGORY_SLUGS)) notFound();
  const { filters, page, sort } = parseDirectoryViewFilters(
    sp,
    VALID_CATEGORY_SLUGS,
  );
  const categorySlug =
    filters.categorySlugs.length === 1
      ? (filters.categorySlugs[0] ?? null)
      : null;
  const resolvedSubcategories = resolveDirectorySubcategorySlugs(
    filters.subcategorySlugs,
  );
  const activeSubcategory =
    resolvedSubcategories.length === 1
      ? resolvedSubcategories.at(0)
      : undefined;
  const directorySeo = resolveDirectorySeo({
    locale: safeLocale,
    surface: "brands",
    categorySlug,
    subcategorySlug: activeSubcategory?.slug,
    page,
    facets: {
      search: sp.search,
      sort:
        typeof sp.sort === "string"
          ? sp.sort
          : sort !== "random"
            ? sort
            : undefined,
      category: sp.category,
      sub: sp.sub,
      multiCategory: filters.categorySlugs.length > 1,
      multiSub: filters.subcategorySlugs.length > 1,
    },
  });

  return (
    <DirectoryView
      locale={safeLocale}
      filters={filters}
      page={page}
      sort={sort}
      canonical={directorySeo.canonical}
      indexable={directorySeo.robots?.index !== false}
    />
  );
}
