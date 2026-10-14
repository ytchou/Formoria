import type { PublicBrandDetail } from "@/lib/brands/contracts";
import { getBrandCategoryLabel } from "@/lib/brands/category-label";
import {
  getBrandVisitLink,
  type BrandVisitLink,
} from "@/lib/brands/link-fallback";
import { splitLede } from "@/lib/brands/split-lede";
import type { BreadcrumbItem } from "@/lib/json-ld";
import { routes } from "@/lib/routes";
import { buildAlternates, type Locale } from "@/lib/seo/alternates";
import { L1_CATEGORIES, isVisibleCategory } from "@/lib/taxonomy/ontology";
import { sanitizeHref } from "@/lib/url";

/**
 * The brand story in the page locale. An en page falls back to the zh story;
 * a zh page never reads the en one.
 */
export function localizedDescription(
  brand: Pick<PublicBrandDetail, "description" | "descriptionEn">,
  locale: Locale,
): string | null {
  return locale === "en"
    ? (brand.descriptionEn ?? brand.description)
    : brand.description;
}

export type BrandCategoryTag = {
  slug: string;
  name: string;
  nameZh: string;
};

/**
 * The brand's L1 category when it is public. A deferred category has no tag,
 * so no category crumb, filter link or related-brands rail points at it.
 */
export function brandCategoryTag(
  categorySlug: string | null | undefined,
): BrandCategoryTag | null {
  const category = L1_CATEGORIES.find((item) => item.slug === categorySlug);
  return category && isVisibleCategory(category.slug)
    ? { slug: category.slug, name: category.name, nameZh: category.nameZh }
    : null;
}

export type BrandSectionId =
  | "about"
  | "selected-products"
  | "where-to-buy"
  | "featured-in"
  | "faq"
  | "social";

export type BrandSectionEntry = {
  id: BrandSectionId;
  /** `brandDetail` message key of the section's short nav label. */
  labelKey: `tabNav.short.${string}`;
};

export type BrandSocialLinkFields = Pick<
  PublicBrandDetail,
  "id" | "slug" | "socialInstagram" | "socialThreads" | "socialFacebook"
>;

export type BrandPurchaseLinkFields = Pick<
  PublicBrandDetail,
  | "id"
  | "slug"
  | "purchaseWebsite"
  | "purchasePinkoi"
  | "purchaseShopee"
  | "purchaseMyship"
>;

export type BrandChannelCorrectionFields = BrandSocialLinkFields &
  BrandPurchaseLinkFields;

export type BrandOtherLink = { label: string; url: string };

export type BrandDetailViewInput = {
  brand: PublicBrandDetail;
  locale: Locale;
  /** The translated city name, or null when the brand has no city. */
  cityLabel: string | null;
  /** The translated `breadcrumb.directory` label. */
  directoryLabel: string;
  curatedCount: number;
  stockists: { confirmed: readonly unknown[]; possible: readonly unknown[] };
  hasEditorialAppearances: boolean;
  faqItemCount: number;
};

export type BrandDetailView = {
  categoryTag: BrandCategoryTag | null;
  /** Empty when the brand has no category label in this locale. */
  categoryLabel: string;
  description: string | null;
  /** The hero lede: the story's first sentence, or the en blurb on en pages. */
  lede: string | null;
  /** What the story section renders after the lede; null without a story. */
  storyParagraphs: string[] | null;
  breadcrumb: BreadcrumbItem[];
  /** Every rendered section, in page order — the section nav's source. */
  sections: BrandSectionEntry[];
  heroFacts: {
    cityLabel: string | null;
    foundingYear: number | null;
    selectedCount: number;
    stockistCount: number;
  };
  /** The colophon carries city and founding year, so the metadata line drops them. */
  hasHeroColophon: boolean;
  stockistCount: number;
  visitLink: BrandVisitLink | null;
  canonical: string;
  /**
   * Narrow props for the client link components (BD-18). Each is a fresh
   * object holding only the fields its component reads, so the full brand row
   * is never serialized into the RSC payload once per component.
   */
  links: {
    social: BrandSocialLinkFields;
    purchase: BrandPurchaseLinkFields;
    corrections: BrandChannelCorrectionFields;
    other: BrandOtherLink[];
  };
};

/**
 * Shapes everything the brand detail page renders from data it has already
 * loaded. Pure: no I/O and no translation calls — translated strings arrive as
 * input values.
 */
export function buildBrandDetailView(
  input: BrandDetailViewInput,
): BrandDetailView {
  const { brand, locale, cityLabel } = input;
  const categoryTag = brandCategoryTag(brand.categorySlug);
  // The label follows the L1 entry even when the category is deferred, so the
  // metadata line still names it; only the tag (and so every link) is hidden.
  const l1Category = L1_CATEGORIES.find(
    (category) => category.slug === brand.categorySlug,
  );
  const categoryLabel = l1Category
    ? locale === "en"
      ? l1Category.name
      : l1Category.nameZh
    : getBrandCategoryLabel(brand, locale);

  const description = localizedDescription(brand, locale);
  const lede = description
    ? splitLede(description, locale, {
        brandName: brand.name,
        fallbackLede: locale === "en" ? brand.blurbEn : null,
      }).lede
    : null;
  // The first sentence is the hero lede; the story starts after it, so the
  // sentence is never printed twice.
  const storyParagraphs = description
    ? splitLede(description, locale, { brandName: brand.name }).rest.split(
        "\n\n",
      )
    : null;

  const stockistCount =
    input.stockists.confirmed.length + input.stockists.possible.length;

  // One short label per section (`tabNav.short.*`), in page order, so the
  // strip fits a phone without scrolling (BD2-10); the headings keep their
  // full wording. An entry exists only when its section renders.
  const sections: BrandSectionEntry[] = [
    ...(description
      ? [{ id: "about", labelKey: "tabNav.short.about" } as const]
      : []),
    ...(input.curatedCount > 0
      ? [
          {
            id: "selected-products",
            labelKey: "tabNav.short.selectedProducts",
          } as const,
        ]
      : []),
    // Where-to-buy and social render unconditionally — an empty channel set
    // shows a muted 「還沒有…」 line rather than disappearing.
    { id: "where-to-buy", labelKey: "tabNav.short.whereToBuy" },
    ...(input.hasEditorialAppearances
      ? [{ id: "featured-in", labelKey: "tabNav.short.featuredIn" } as const]
      : []),
    ...(input.faqItemCount > 0
      ? [{ id: "faq", labelKey: "tabNav.short.faq" } as const]
      : []),
    { id: "social", labelKey: "tabNav.short.social" },
  ];

  const breadcrumb: BreadcrumbItem[] = [
    { label: input.directoryLabel, href: routes.brands() },
    ...(categoryTag
      ? [
          {
            label: categoryLabel || categoryTag.name,
            href: routes.brands({ category: categoryTag.slug }),
          },
        ]
      : []),
    { label: brand.name },
  ];

  const social: BrandSocialLinkFields = {
    id: brand.id,
    slug: brand.slug,
    socialInstagram: brand.socialInstagram,
    socialThreads: brand.socialThreads,
    socialFacebook: brand.socialFacebook,
  };
  const purchase: BrandPurchaseLinkFields = {
    id: brand.id,
    slug: brand.slug,
    purchaseWebsite: brand.purchaseWebsite,
    purchasePinkoi: brand.purchasePinkoi,
    purchaseShopee: brand.purchaseShopee,
    purchaseMyship: brand.purchaseMyship,
  };
  // Only links we can name and safely open render.
  const other = brand.otherUrls.flatMap((otherUrl) => {
    const label = otherUrl.label?.trim() ?? "";
    const url = sanitizeHref(otherUrl.url);
    return label && url ? [{ label, url }] : [];
  });

  return {
    categoryTag,
    categoryLabel,
    description,
    lede,
    storyParagraphs,
    breadcrumb,
    sections,
    heroFacts: {
      cityLabel,
      foundingYear: brand.foundingYear,
      selectedCount: input.curatedCount,
      stockistCount,
    },
    hasHeroColophon: Boolean(cityLabel) || brand.foundingYear != null,
    stockistCount,
    visitLink: getBrandVisitLink(brand),
    // Same builder generateMetadata uses for <link rel="canonical">, so the
    // structured data can never name a different URL than the page's own tag.
    canonical: buildAlternates(routes.brand(brand.slug), locale).canonical,
    links: {
      social,
      purchase,
      corrections: { ...social, ...purchase },
      other,
    },
  };
}
