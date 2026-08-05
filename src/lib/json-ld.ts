import type { Brand } from "@/lib/types";
import type { Locale } from "@/lib/seo/alternates";
import { PURCHASE_CHANNELS } from "@/lib/brands/purchase-channels";
import { FORMORIA_SOCIALS } from "./constants";
import { getSiteUrl } from "./seo/site-url";

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

type JsonLdLocale = Locale | string | undefined;

/** Map a next-intl locale to a schema.org inLanguage value. */
function toInLanguage(locale: JsonLdLocale = "zh-TW"): string {
  return locale === "zh-TW" ? "zh-TW" : "en";
}

/**
 * Build Organization JSON-LD structured data for a brand detail page.
 */
export function buildBrandJsonLd(
  brand: Brand,
  locale: Locale = "zh-TW",
): JsonLdObject {
  const allSameAs = [
    brand.socialInstagram,
    brand.socialThreads,
    brand.socialFacebook,
    ...PURCHASE_CHANNELS.map((channel) => brand[channel.camel]),
    ...(brand.otherUrls ?? []).map((link) => link.url),
  ].filter(
    (url): url is string => typeof url === "string" && url.trim().length > 0,
  );

  const jsonLd: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: brand.name,
    description:
      (locale === "en"
        ? (brand.descriptionEn ?? brand.description)
        : brand.description) ?? undefined,
    inLanguage: toInLanguage(locale),
  };

  const url =
    PURCHASE_CHANNELS.map((channel) => brand[channel.camel]).find(
      (value): value is string => value !== null && value !== undefined,
    ) ?? null;
  if (url) jsonLd.url = url;
  if (brand.heroImageUrl) jsonLd.logo = brand.heroImageUrl;
  if (brand.foundingYear) jsonLd.foundingDate = String(brand.foundingYear);
  if (allSameAs.length > 0) jsonLd.sameAs = allSameAs;

  return jsonLd;
}

/**
 * Build BreadcrumbList JSON-LD structured data.
 */
export function buildBreadcrumbJsonLd(
  items: BreadcrumbItem[],
  locale: Locale = "zh-TW",
): JsonLdObject {
  const siteUrl = getSiteUrl();

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
        element.item = `${siteUrl}${item.href}`;
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
  categorySlug: string,
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
    url: `${siteUrl}/brands?category=${categorySlug}`,
    inLanguage: toInLanguage(locale),
    numberOfItems: brands.length,
    itemListElement: brands.map((brand, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: brand.name,
      url: `${siteUrl}/brands/${brand.slug}`,
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
        ? "Formoria 是台灣品牌探索與選物平台，讓台灣品牌更容易被看見、被選擇，也更容易成長。"
        : "Formoria is a Taiwanese brand discovery and curation platform that makes brands easier to discover, choose, and grow.",
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
}: {
  title: string;
  description: string;
  path: string;
  locale?: string;
  /** Visible byline, when the story names one. Falls back to the publisher. */
  author?: string;
}): JsonLdObject {
  const siteUrl = getSiteUrl();
  const absoluteUrl = `${siteUrl}${path.startsWith("/") ? path : `/${path}`}`;

  return {
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

  if (imageUrl) jsonLd.image = imageUrl;

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

/**
 * Build DefinedTermSet JSON-LD structured data for glossary pages.
 */
export function buildDefinedTermSetJsonLd(
  terms: Array<{ name: string; description: string }>,
  locale?: string,
): JsonLdObject {
  const inLanguage = toInLanguage(locale);

  return {
    "@context": "https://schema.org",
    "@type": "DefinedTermSet",
    name: inLanguage === "zh-TW" ? "Formoria 詞彙表" : "Formoria Glossary",
    inLanguage,
    hasDefinedTerm: terms.map((term) => ({
      "@type": "DefinedTerm",
      name: term.name,
      description: term.description,
    })),
  };
}

export type FaqQuestion = {
  q: string;
  a: string;
};

/**
 * Build FAQPage JSON-LD structured data for an editorial FAQ block.
 * Returns null when there is nothing to describe so callers can skip
 * rendering the <script> tag entirely.
 */
export function buildFaqPageJsonLd(
  questions: FaqQuestion[] | null | undefined,
  locale?: string,
): JsonLdObject | null {
  const entries = questions ?? [];
  if (entries.length === 0) return null;

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: toInLanguage(locale),
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: entry.a,
      },
    })),
  };
}

export function safeJsonLdStringify(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
