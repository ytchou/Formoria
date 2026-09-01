import type { Locale } from "@/lib/seo/alternates";
import { buildAlternates } from "@/lib/seo/alternates";
import { ONLINE_STORES } from "@/lib/brands/online-stores";
import { absoluteImageUrl } from "@/lib/images/image-url";
import { FORMORIA_SOCIALS } from "./constants";
import { getSiteUrl } from "./seo/site-url";
import type { Stockist } from "./types/stockist";
export type BreadcrumbItem = {
  label: string;
  href?: string;
};

/**
 * schema.org JSON-LD output — values can be any valid JSON type plus nested objects.
 * Record<string, any> is the correct type here: JSON-LD objects are deliberately
 * open-ended schema.org structures, not domain types we control.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonLdObject = Record<string, any>;

export type BrandJsonLdInput = {
  name: string;
  description: string | null;
  descriptionEn: string | null;
  heroImageUrl: string | null;
  heroImageAlt?: string | null;
  foundingYear: number | null;
  socialInstagram: string | null;
  socialThreads: string | null;
  socialFacebook: string | null;
  purchaseWebsite: string | null;
  purchasePinkoi: string | null;
  purchaseShopee: string | null;
  purchaseMyship: string | null;
  otherUrls: Array<{ label: string; url: string }>;
};

type JsonLdLocale = Locale | string | undefined;

/** Map a next-intl locale to a schema.org inLanguage value. */
function toInLanguage(locale: JsonLdLocale = "zh-TW"): string {
  return locale === "zh-TW" ? "zh-TW" : "en";
}

/**
 * Build Organization JSON-LD structured data for a brand detail page.
 *
 * `canonicalUrl` is what separates the zh-TW and /en editions as DOCUMENTS.
 * Without it both locales emit an Organization carrying the same name, the same
 * external `url` and the same `sameAs` set, with nothing stating which page
 * describes it — two indistinguishable descriptions of one entity, which is a
 * consolidation signal on a pair Search Console already reports as
 * "Duplicate, Google chose different canonical than user".
 *
 * `@id` is locale-scoped and `mainEntityOfPage` names this page specifically;
 * the shared external `url` stays put, because both editions really are about
 * the same company.
 */
export function buildBrandJsonLd(
  brand: BrandJsonLdInput,
  locale: Locale = "zh-TW",
  canonicalUrl?: string,
  stockists: Stockist[] = [],
): JsonLdObject {
  const allSameAs = [
    brand.socialInstagram,
    brand.socialThreads,
    brand.socialFacebook,
    ...ONLINE_STORES.map((channel) => brand[channel.camel]),
    ...(brand.otherUrls ?? []).map((link) => link.url),
  ].filter(
    (url): url is string => typeof url === "string" && url.trim().length > 0,
  );

  const jsonLd: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": "Organization",
    ...(canonicalUrl ? { "@id": `${canonicalUrl}#organization` } : {}),
    name: brand.name,
    description:
      (locale === "en"
        ? (brand.descriptionEn ?? brand.description)
        : brand.description) ?? undefined,
    inLanguage: toInLanguage(locale),
    ...(canonicalUrl ? { mainEntityOfPage: canonicalUrl } : {}),
  };

  const url =
    ONLINE_STORES.map((channel) => brand[channel.camel]).find(
      (value): value is string => value !== null && value !== undefined,
    ) ?? null;
  if (url) jsonLd.url = url;
  // JSON-LD is raw JSON inside a <script> tag, so `metadataBase` never touches
  // it: `heroImageUrl` is the relative `/i/<key>` proxy path since DEV-1551,
  // and Google drops `Organization.logo` when the IRI is not absolute.
  const logo = absoluteImageUrl(brand.heroImageUrl);
  if (logo) {
    jsonLd.logo = brand.heroImageAlt
      ? { "@type": "ImageObject", url: logo, description: brand.heroImageAlt }
      : logo;
  }
  if (brand.foundingYear) jsonLd.foundingDate = String(brand.foundingYear);
  if (allSameAs.length > 0) jsonLd.sameAs = allSameAs;

  const ownPlaces = stockists
    .filter(
      (stockist) =>
        stockist.locationType === "direct_store" ||
        stockist.locationType === "showroom_studio",
    )
    .map((stockist) => ({
      "@type": "Place",
      name: stockist.name,
      ...(stockist.address ? { address: stockist.address } : {}),
      ...(stockist.url ? { url: stockist.url } : {}),
    }));
  if (ownPlaces.length > 0) jsonLd.location = ownPlaces;

  return jsonLd;
}

/**
 * Build BreadcrumbList JSON-LD structured data.
 */
export function buildBreadcrumbJsonLd(
  items: BreadcrumbItem[],
  localeOrCanonical: Locale | string = "zh-TW",
): JsonLdObject {
  const siteUrl = getSiteUrl();
  const locale: Locale =
    localeOrCanonical === "en" || localeOrCanonical === "zh-TW"
      ? localeOrCanonical
      : "zh-TW";

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    inLanguage: toInLanguage(locale),
    itemListElement: items.map((item, index) => {
      const element: JsonLdObject = {
        "@type": "ListItem",
        position: index + 1,
        name: item.label,
      };
      if (item.href) {
        // Callers that already resolved a canonical URL pass it through
        // untouched. Legacy callers still pass a path; use the shared
        // alternates builder so locale prefixing remains one-source-of-truth.
        if (/^https?:\/\//.test(item.href)) {
          element.item = item.href;
        } else if (item.href === "/en" || item.href.startsWith("/en/")) {
          element.item = `${siteUrl}${item.href}`;
        } else {
          element.item = buildAlternates(item.href, locale).canonical;
        }
      }
      return element;
    }),
  };
}

/**
 * Build ItemList JSON-LD structured data for a category page.
 */
export function buildCategoryItemListJsonLd(
  categoryName: string,
  canonicalUrl: string,
  brands: Array<{ name: string; slug: string }>,
  locale: Locale = "zh-TW",
  description?: string,
  parentGroup?: string,
): JsonLdObject {
  const siteUrl = getSiteUrl();
  const parentGroupName = parentGroup?.trim();

  const jsonLd: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${categoryName} — Taiwanese Brands`,
    url: canonicalUrl,
    inLanguage: toInLanguage(locale),
    numberOfItems: brands.length,
    itemListElement: brands.map((brand, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: brand.name,
      url: `${siteUrl}${locale === "en" ? "/en" : ""}/brands/${brand.slug}`,
    })),
    ...(parentGroupName
      ? { about: { "@type": "Thing", name: parentGroupName } }
      : {}),
  };

  if (description) jsonLd.description = description;

  return jsonLd;
}

export function buildBrandsItemListJsonLd(
  brands: Array<{ name: string; slug: string }>,
  locale: Locale = "zh-TW",
): JsonLdObject {
  const siteUrl = getSiteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: locale === "zh-TW" ? "台灣品牌目錄" : "Taiwan Brands Directory",
    inLanguage: toInLanguage(locale),
    numberOfItems: brands.length,
    itemListElement: brands.map((b, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: b.name,
      url: `${siteUrl}${locale === "en" ? "/en" : ""}/brands/${b.slug}`,
    })),
  };
}

/**
 * Build WebSite JSON-LD structured data for the home page.
 */
export function buildWebSiteJsonLd(locale: Locale = "zh-TW"): JsonLdObject {
  const siteUrl = getSiteUrl();
  const inLanguage = toInLanguage(locale);

  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    // Stable node id so WebSite and Organization resolve as one entity rather
    // than two unrelated nodes — "Formoria" collides with an unrelated homonym
    // in search results, so the graph edges are what disambiguate us (DEV-1320).
    "@id": `${siteUrl}/#website`,
    name: "Formoria",
    alternateName:
      inLanguage === "zh-TW"
        ? "Formoria 台灣品牌探索與選物平台"
        : "Formoria Taiwanese Brand Discovery & Curation",
    url: siteUrl,
    publisher: { "@id": `${siteUrl}/#organization` },
    inLanguage,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${siteUrl}/brands?search={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/**
 * Build Formoria Organization JSON-LD structured data.
 */
export function buildOrganizationJsonLd(locale?: string): JsonLdObject {
  const siteUrl = getSiteUrl();
  const inLanguage = toInLanguage(locale);

  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${siteUrl}/#organization`,
    name: "Formoria",
    alternateName:
      inLanguage === "zh-TW"
        ? "Formoria 台灣品牌探索與選物平台"
        : "Formoria Taiwanese Brand Discovery & Curation",
    url: siteUrl,
    logo: `${siteUrl}/images/formoria-mark.png`,
    description:
      inLanguage === "zh-TW"
        ? "Formoria 把相遇之後的路接起來：從一件喜歡的東西，走到它的品牌、它的故事，和買得到它的地方。Formoria 負責靈感、選擇、脈絡與前往外部通路的路徑；品牌或零售通路負責價格、規格選項、庫存、結帳、出貨與售後服務。"
        : "Formoria reconnects the path after that moment: from one thing you love, to its brand, its story, and the place you can buy it. Formoria owns inspiration, selection, context, and the outbound route. Brands or retailers remain responsible for price, variants, inventory, checkout, fulfilment, and after-sales service.",
    inLanguage,
    ...(FORMORIA_SOCIALS.length > 0 ? { sameAs: FORMORIA_SOCIALS } : {}),
  };
}

/**
 * Build Article JSON-LD structured data for editorial pages.
 */
export function buildArticleJsonLd({
  title,
  description,
  path,
  locale,
  author,
  image,
}: {
  title: string;
  description: string;
  path: string;
  locale?: string;
  /** Visible byline, when the story names one. Falls back to the publisher. */
  author?: string;
  /**
   * The entry's lead image — the same file the page renders as its LCP element.
   * A repo-relative path (`/images/…`) is absolutised below; an absolute URL is
   * passed through. Absent or blank emits no `image` key at all.
   */
  image?: string | null;
}): JsonLdObject {
  const siteUrl = getSiteUrl();
  const absoluteUrl = `${siteUrl}${path.startsWith("/") ? path : `/${path}`}`;
  // Structured data has no page to resolve a relative reference against, so a
  // leading-slash repo path is meaningless there even though it renders fine in
  // the `<img>`. Resolved once here rather than at each caller, because both
  // callers hold exactly the same kind of value.
  const imageUrl = absoluteImageUrl(image);

  const jsonLd: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description,
    inLanguage: toInLanguage(locale),
    mainEntityOfPage: absoluteUrl,
    // Mirrors the visible byline. An Article with a printed author and no
    // structured one is the inconsistency Google's own Article guidance calls
    // out; the fallback matches the page's `stories.byline` default.
    author: author
      ? { "@type": "Person", name: author }
      : buildOrganizationJsonLd(locale),
    publisher: buildOrganizationJsonLd(locale),
    isPartOf: buildWebSiteJsonLd(locale === "zh-TW" ? "zh-TW" : "en"),
  };

  // Conditional: an empty string is reported by Google as an invalid value,
  // which is worse than no key.
  if (imageUrl) jsonLd.image = imageUrl;

  return jsonLd;
}

export type EventJsonLdInput = {
  name: string;
  description?: string | null;
  /** Formoria page path for the event, e.g. `/events/creative-expo-2026`. */
  path: string;
  locale?: string;
  /** Calendar date, `YYYY-MM-DD`. Emitted verbatim — see the note below. */
  startDate: string;
  /** Calendar date, `YYYY-MM-DD`. Omitted for single-day events. */
  endDate?: string | null;
  venueName?: string | null;
  venueAddress?: string | null;
  city?: string | null;
  organizerName?: string | null;
  imageUrl?: string | null;
  /** `null` = ticketing unknown, so no `offers` is emitted at all. */
  isFree?: boolean | null;
  ticketUrl?: string | null;
};

/**
 * Build Event JSON-LD structured data for an event detail page.
 *
 * Dates are passed through verbatim as `YYYY-MM-DD` calendar dates. Do NOT
 * introduce `new Date(...)` / `.toISOString()` here: parsing a bare date string
 * yields UTC midnight, so a Taipei (UTC+8) event on 2026-08-06 would serialize
 * as 2026-08-05T16:00:00Z and Google would index the event a day early — a
 * failure only visible in Search Console weeks later.
 */
export function buildEventJsonLd({
  name,
  description,
  path,
  locale,
  startDate,
  endDate,
  venueName,
  venueAddress,
  city,
  organizerName,
  imageUrl,
  isFree,
  ticketUrl,
}: EventJsonLdInput): JsonLdObject {
  const siteUrl = getSiteUrl();
  const absoluteUrl = `${siteUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const jsonLd: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": "Event",
    name,
    inLanguage: toInLanguage(locale),
    url: absoluteUrl,
    startDate,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    // Constant by design: schema.org has no "finished" state, so a past event
    // stays EventScheduled. Never derive this from the event's phase.
    eventStatus: "https://schema.org/EventScheduled",
  };

  if (description) jsonLd.description = description;
  if (endDate) jsonLd.endDate = endDate;

  // Conditional blocks are omitted entirely rather than stubbed — a wholly
  // empty Place or a priceless free Offer is worse for Google than no key at
  // all. But `location` is a REQUIRED property of the Event rich result and
  // `venue_name` / `venue_address` / `city` are independently nullable, so the
  // block is gated on any one of them being present, not on the name alone:
  // schema.org does not require `Place.name`, and a Place carrying only a
  // PostalAddress is valid. `name` and `address` are each included only when
  // there is something to put in them.
  if (venueName || venueAddress || city) {
    const place: JsonLdObject = { "@type": "Place" };
    if (venueName) place.name = venueName;
    if (venueAddress || city) {
      place.address = {
        "@type": "PostalAddress",
        ...(venueAddress ? { streetAddress: venueAddress } : {}),
        ...(city ? { addressLocality: city } : {}),
        addressCountry: "TW",
      };
    }
    jsonLd.location = place;
  }

  if (organizerName) {
    jsonLd.organizer = { "@type": "Organization", name: organizerName };
  }

  // Same absolutisation as the brand logo and the story image: `imageUrl`
  // arrives as `safeImageSrc(imagePathToUrl(...))`, a relative proxy path, and
  // `Event.image` is required for the rich result.
  const absoluteEventImage = absoluteImageUrl(imageUrl);
  if (absoluteEventImage) jsonLd.image = absoluteEventImage;

  if (isFree === true) {
    jsonLd.offers = {
      "@type": "Offer",
      price: "0",
      priceCurrency: "TWD",
      ...(ticketUrl ? { url: ticketUrl } : {}),
    };
  } else if (isFree === false && ticketUrl) {
    // Ticket prices are not tracked, so the Offer carries only where to buy.
    jsonLd.offers = { "@type": "Offer", url: ticketUrl };
  }

  return jsonLd;
}

export function safeJsonLdStringify(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
