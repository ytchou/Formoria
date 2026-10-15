import type { PublicBrandDetail } from "@/lib/brands/contracts";
import { getBrandCategoryLabel } from "@/lib/brands/category-label";
import {
  classifyBrandLinkKind,
  getBrandVisitLink,
  type BrandVisitLink,
  type BrandVisitLinkFields,
  type BrandVisitLinkKind,
} from "@/lib/brands/link-fallback";
import {
  ONLINE_STORES,
  onlineStoreMessageKey,
} from "@/lib/brands/online-stores";
import { splitLede } from "@/lib/brands/split-lede";
import { brandHeroFrame, type BrandHeroFrame } from "@/lib/images/fill";
import { groupStockistsByRegion } from "@/lib/brands/stockist-display";
import type { BreadcrumbItem } from "@/lib/json-ld";
import { routes } from "@/lib/routes";
import { buildAlternates, type Locale } from "@/lib/seo/alternates";
import {
  L1_CATEGORIES,
  isVisibleCategory,
  subcategoryDisplayLabel,
} from "@/lib/taxonomy/ontology";
import type { Stockist } from "@/lib/types";
import {
  normalizeInstagramHref,
  normalizeThreadsHref,
  sanitizeHref,
} from "@/lib/url";

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

type BrandSectionId =
  | "selected-products"
  | "where-to-buy"
  | "about"
  | "featured-in"
  | "faq";

type BrandSectionEntry = {
  id: BrandSectionId;
  /** `brandDetail` message key of the section's short nav label. */
  labelKey: `tabNav.short.${string}`;
};

/**
 * One live brand channel: a purchase store or a social profile we hold a URL
 * for. The hero route rows and the where-to-buy list both render from these,
 * so the two can never disagree about a channel's name, URL or tracked kind.
 */
export type BrandChannelSlot = {
  /** The channel the URL really goes to (`classifyBrandLinkKind`). */
  kind: BrandVisitLinkKind;
  /** `brandDetail` message key of the channel name. */
  labelKey: `links.${string}`;
  url: string;
  /** The destination hostname without `www.`; null when it does not parse. */
  host: string | null;
};

export type BrandChannelSlots = {
  /** Purchase stores, in registry order (official site first). */
  purchase: BrandChannelSlot[];
  /** Instagram, Threads, Facebook — in that order. */
  social: BrandChannelSlot[];
};

/** A city the brand's stockists sit in, with how many sit there. */
export type BrandStockistCity = { citySlug: string; count: number };

/** How many cities the hero's stockist row names. */
const HERO_STOCKIST_CITY_LIMIT = 2;
/** How many 「做什麼」 labels the hero names. */
const MAKES_LABEL_LIMIT = 3;

function channelHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "") || null;
  } catch {
    return null;
  }
}

/**
 * Every channel the brand can be reached through, purchase stores first, then
 * social. Only known destinations: a field without a usable URL yields no slot.
 */
export function buildBrandChannelSlots(
  brand: BrandVisitLinkFields,
): BrandChannelSlots {
  const purchase = ONLINE_STORES.flatMap((channel) => {
    const url = sanitizeHref(brand[channel.camel]);
    if (!url) return [];
    // A marketplace URL stored in another store's field is named by where it
    // actually goes.
    const kind = classifyBrandLinkKind(url, channel.key);
    const labelKey = (
      kind === channel.key
        ? onlineStoreMessageKey(
            channel.messageKeys.brandDetailLink,
            "brandDetail",
          )
        : `links.${kind}`
    ) as BrandChannelSlot["labelKey"];
    return [{ kind, labelKey, url, host: channelHost(url) }];
  });
  const socialCandidates: ReadonlyArray<
    readonly [BrandVisitLinkKind, string | null]
  > = [
    ["instagram", normalizeInstagramHref(brand.socialInstagram)],
    ["threads", normalizeThreadsHref(brand.socialThreads)],
    ["facebook", sanitizeHref(brand.socialFacebook)],
  ];
  const social = socialCandidates.flatMap(([kind, url]) =>
    url
      ? [
          {
            kind,
            labelKey: `links.${kind}` as const,
            url,
            host: channelHost(url),
          },
        ]
      : [],
  );
  return { purchase, social };
}

/**
 * The cities holding the most stockists, most first, from the same grouping
 * the stockist list uses (臺 folds to 台 there). Chains and overseas or
 * unmapped rows are not a city, so they are never named.
 */
export function topStockistCities(
  stockists: readonly Stockist[],
  limit: number = HERO_STOCKIST_CITY_LIMIT,
): BrandStockistCity[] {
  return groupStockistsByRegion([...stockists])
    .filter((group) => group.key !== "overseas" && group.key !== "all_taiwan")
    .slice(0, limit)
    .map((group) => ({ citySlug: group.key, count: group.stockists.length }));
}

/**
 * Up to three distinct subcategory labels for what the brand makes: the
 * selected products' subcategories, most products first (ties by first
 * appearance), else the brand's own subcategories.
 */
export function brandMakesLabels(
  productSubcategories: readonly (string | null)[],
  brandSubcategories: readonly string[],
  locale: Locale,
): string[] {
  const counts = new Map<string, number>();
  for (const subcategory of productSubcategories) {
    if (subcategory)
      counts.set(subcategory, (counts.get(subcategory) ?? 0) + 1);
  }
  // Map iteration keeps first-appearance order and the sort is stable, so
  // equal counts stay in that order.
  const slugs =
    counts.size > 0
      ? [...counts.entries()]
          .sort((left, right) => right[1] - left[1])
          .map(([slug]) => slug)
      : brandSubcategories;
  const labels: string[] = [];
  for (const slug of slugs) {
    const label = subcategoryDisplayLabel(slug, locale).trim();
    if (label && !labels.includes(label)) labels.push(label);
    if (labels.length === MAKES_LABEL_LIMIT) break;
  }
  return labels;
}

type BrandSocialLinkFields = Pick<
  PublicBrandDetail,
  "id" | "slug" | "socialInstagram" | "socialThreads" | "socialFacebook"
>;

type BrandPurchaseLinkFields = Pick<
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
  /** The selected products' subcategories, in shelf order (nulls allowed). */
  curatedSubcategories: readonly (string | null)[];
  stockists: { confirmed: readonly Stockist[]; possible: readonly Stockist[] };
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
  /** 「做什麼」: up to three subcategory labels, empty when none is known. */
  makesLabels: string[];
  /** What the story section renders after the lede; null without a story. */
  storyParagraphs: string[] | null;
  breadcrumb: BreadcrumbItem[];
  /** Every rendered section, in page order — the section nav's source. */
  sections: BrandSectionEntry[];
  /** The hero box's ratio, from the hero image's stored dimensions (BD-08). */
  heroFrame: BrandHeroFrame;
  heroFacts: {
    selectedCount: number;
    stockistCount: number;
    /** The two cities with the most stockists, most first. */
    stockistCities: BrandStockistCity[];
    /** Every live channel, purchase stores first, for the hero route rows. */
    channels: BrandChannelSlot[];
  };
  /**
   * The founding fact set under the story (BD-21, BD-22): `brands.city` is the
   * founding city, so it reads 「2018 年創立於嘉義市」 as one fact. Null without
   * a story or without either fact; the metadata line then keeps both. When
   * present the metadata line drops both. The year is null when the lede
   * already states it.
   */
  colophon: { cityLabel: string | null; foundingYear: number | null } | null;
  stockistCount: number;
  visitLink: BrandVisitLink | null;
  canonical: string;
  /**
   * Narrow props for the client link components (BD-18). Each is a fresh
   * object holding only the fields its component reads, so the full brand row
   * is never serialized into the RSC payload once per component.
   */
  links: {
    /** What click tracking needs to know about the brand. */
    tracked: Pick<PublicBrandDetail, "id" | "slug">;
    /** The selected-products shelf's route-out fallback (BD-18). */
    visit: BrandVisitLinkFields & { slug: string };
    channels: BrandChannelSlots;
    corrections: BrandChannelCorrectionFields;
    other: BrandOtherLink[];
  };
};

/**
 * Most route rows the hero's facts cell holds (channels plus in-page jumps),
 * per hero frame. Re-derived for BD-08 at 1440, where the 7/12 gallery column
 * is 672px wide: the square frame is 672px tall, the 4:3 frame 504px. With the
 * colophon moved to the story band (BD-22), five rows end a sparse brand's
 * column 5px above the square frame; under the 4:3 frame three rows ran 41px
 * past it and two end level. Every channel still lists in where-to-buy, so a
 * capped one is never lost. Re-measure if the hero frame or the info column
 * changes.
 */
const HERO_ROUTE_ROWS_MAX: Record<BrandHeroFrame, number> = {
  square: 5,
  landscape: 2,
};

/**
 * The story band's founding fact. A year the lede already states is dropped
 * rather than printed twice (lid-shoes: 「可追溯至1967年」 above 「1967」).
 */
function buildColophon(
  cityLabel: string | null,
  foundingYear: number | null,
  { hasStory, lede }: { hasStory: boolean; lede: string | null },
): BrandDetailView["colophon"] {
  if (!hasStory || (!cityLabel && foundingYear == null)) return null;
  // Both fields can end up null (a year-only brand whose lede names the
  // year): the colophon then renders nothing, and the metadata line still
  // leaves the year out.
  const year =
    foundingYear != null && !lede?.includes(String(foundingYear))
      ? foundingYear
      : null;
  return { cityLabel, foundingYear: year };
}

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

  const heroFrame = brandHeroFrame(brand.heroImageMetadata);
  const stockistCount =
    input.stockists.confirmed.length + input.stockists.possible.length;
  const channels = buildBrandChannelSlots(brand);

  // One short label per section (`tabNav.short.*`), in page order, so the
  // strip fits a phone without scrolling (BD2-10); the headings keep their
  // full wording. An entry exists only when its section renders.
  const sections: BrandSectionEntry[] = [
    // Product-led (BD-01): the shelf comes straight after the hero, then the
    // route out, then the story beside it in one band.
    ...(input.curatedCount > 0
      ? [
          {
            id: "selected-products",
            labelKey: "tabNav.short.selectedProducts",
          } as const,
        ]
      : []),
    // Where-to-buy renders unconditionally: with no online store it shows a
    // muted line, and its social block drops out without comment.
    { id: "where-to-buy", labelKey: "tabNav.short.whereToBuy" },
    ...(description
      ? [{ id: "about", labelKey: "tabNav.short.about" } as const]
      : []),
    ...(input.hasEditorialAppearances
      ? [{ id: "featured-in", labelKey: "tabNav.short.featuredIn" } as const]
      : []),
    ...(input.faqItemCount > 0
      ? [{ id: "faq", labelKey: "tabNav.short.faq" } as const]
      : []),
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
    makesLabels: brandMakesLabels(
      input.curatedSubcategories,
      brand.subcategories,
      locale,
    ),
    storyParagraphs,
    breadcrumb,
    sections,
    heroFrame,
    heroFacts: {
      selectedCount: input.curatedCount,
      stockistCount,
      stockistCities: topStockistCities([
        ...input.stockists.confirmed,
        ...input.stockists.possible,
      ]),
      // The jump rows stay; channels fill what is left of the cap.
      channels: [...channels.purchase, ...channels.social].slice(
        0,
        Math.max(
          0,
          HERO_ROUTE_ROWS_MAX[heroFrame] -
            (input.curatedCount > 0 ? 1 : 0) -
            (stockistCount > 0 ? 1 : 0),
        ),
      ),
    },
    colophon: buildColophon(cityLabel, brand.foundingYear, {
      hasStory: storyParagraphs != null,
      lede,
    }),
    stockistCount,
    visitLink: getBrandVisitLink(brand),
    // Same builder generateMetadata uses for <link rel="canonical">, so the
    // structured data can never name a different URL than the page's own tag.
    canonical: buildAlternates(routes.brand(brand.slug), locale).canonical,
    links: {
      tracked: { id: brand.id, slug: brand.slug },
      visit: {
        slug: brand.slug,
        purchaseWebsite: brand.purchaseWebsite,
        purchasePinkoi: brand.purchasePinkoi,
        purchaseShopee: brand.purchaseShopee,
        purchaseMyship: brand.purchaseMyship,
        socialInstagram: brand.socialInstagram,
        socialThreads: brand.socialThreads,
        socialFacebook: brand.socialFacebook,
      },
      channels,
      corrections: { ...social, ...purchase },
      other,
    },
  };
}
