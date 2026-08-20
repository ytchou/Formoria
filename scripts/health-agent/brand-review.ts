import type { MitStatus } from "@/lib/types";

import {
  stableFingerprint,
  type HealthFinding,
  type JsonValue,
} from "./contracts";

const THIRD_PARTY_DIRECTORY_HOSTS = ["twrr.org.tw"] as const;
const SOCIAL_HOSTS = [
  "threads.com",
  "threads.net",
  "instagram.com",
  "facebook.com",
] as const;

export interface RecentBrandEdit {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly descriptionEn: string | null;
  readonly mitStatus: MitStatus | null;
  readonly mitDeclaredScope: "all" | "most" | "some" | null;
  readonly mitDeclaredAt: string | null;
  readonly mitVerifiedAt: string | null;
  readonly purchaseWebsite: string | null;
  readonly purchasePinkoi: string | null;
  readonly purchaseShopee: string | null;
  readonly socialInstagram: string | null;
  readonly socialThreads: string | null;
  readonly socialFacebook: string | null;
  readonly otherUrls: readonly { label: string; url: string }[] | null;
}

export interface BrandReviewSnapshot {
  readonly reviewedCount: number;
  readonly findingCount: number;
  readonly windowStartIso: string;
  readonly nowIso: string;
}

/**
 * Locale-independent string ordering for finding sorts. Exported because
 * `trail-supply.ts` sorts its findings by fingerprint the same way, and a
 * second inline copy of this three-line comparator is how two detectors drift
 * into two different orderings.
 */
export function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function finding(
  kind: string,
  brand: RecentBrandEdit,
  title: string,
  severity: HealthFinding["severity"],
  evidence: Record<string, JsonValue>,
): HealthFinding {
  return {
    source: "directory",
    fingerprint: stableFingerprint("directory", kind, brand.id),
    title,
    severity,
    evidence,
    mergePolicy: "human",
  };
}

function checkMitConsistency(brand: RecentBrandEdit): HealthFinding[] {
  if (brand.mitStatus === null || brand.mitStatus === "unverified") {
    return [];
  }

  const findings: HealthFinding[] = [];
  const evidence = {
    brandId: brand.id,
    brandName: brand.name,
    mitStatus: brand.mitStatus,
  };

  if (brand.mitStatus === "declared") {
    if (brand.mitDeclaredScope === null) {
      findings.push(
        finding(
          "brand-review-mit-consistency",
          brand,
          "MIT declared without scope",
          "medium",
          evidence,
        ),
      );
    }

    if (brand.mitDeclaredAt === null) {
      findings.push(
        finding(
          "brand-review-mit-consistency",
          brand,
          "MIT declared without date",
          "medium",
          evidence,
        ),
      );
    }
  }

  if (brand.mitStatus === "verified" && brand.mitVerifiedAt === null) {
    findings.push(
      finding(
        "brand-review-mit-consistency",
        brand,
        "MIT verified without evidence",
        "medium",
        evidence,
      ),
    );
  }

  return findings;
}

function countCjkCharacters(value: string | null): number {
  return value?.match(/[一-鿿]/g)?.length ?? 0;
}

function cjkRatio(value: string | null): number {
  const significant = value?.replace(/\s+/g, "") ?? "";
  if (significant.length === 0) return 0;
  return countCjkCharacters(significant) / significant.length;
}

// A correct English description that embeds the brand's own Chinese name sits
// around 0.01-0.05; a description genuinely swapped into the EN field sits near
// 1.0. 0.3 separates the two with a wide margin in both directions.
const SWAPPED_DESCRIPTION_CJK_RATIO = 0.3;

function checkDescriptionLanguageSwap(brand: RecentBrandEdit): HealthFinding[] {
  if (brand.description === null && brand.descriptionEn === null) {
    return [];
  }

  const descriptionCjkCount = countCjkCharacters(brand.description);
  const descriptionEnCjkCount = countCjkCharacters(brand.descriptionEn);
  const descriptionEnCjkRatio =
    Math.round(cjkRatio(brand.descriptionEn) * 1000) / 1000;
  const evidence = {
    brandId: brand.id,
    brandName: brand.name,
    descriptionCjkCount,
    descriptionEnCjkCount,
    descriptionEnCjkRatio,
  };

  if (
    descriptionCjkCount === 0 &&
    descriptionEnCjkRatio >= SWAPPED_DESCRIPTION_CJK_RATIO
  ) {
    return [
      finding(
        "brand-review-language-swap",
        brand,
        "Description language may be swapped (CJK in EN field)",
        "low",
        evidence,
      ),
    ];
  }

  if (
    descriptionCjkCount >= 3 &&
    descriptionEnCjkRatio >= SWAPPED_DESCRIPTION_CJK_RATIO
  ) {
    return [
      finding(
        "brand-review-language-swap",
        brand,
        "EN description contains CJK characters",
        "low",
        evidence,
      ),
    ];
  }

  return [];
}

// Deliberately excludes purchasePinkoi/purchaseShopee. A fully-populated brand
// already reaches 4 domains here; adding the two marketplaces puts it at 6 and
// trips checkExcessiveDomainDiversity's >5 threshold on a perfectly healthy
// record. Widen this only together with that threshold.
function collectBrandUrls(brand: RecentBrandEdit): string[] {
  return [
    brand.purchaseWebsite,
    brand.socialInstagram,
    brand.socialThreads,
    brand.socialFacebook,
    ...(brand.otherUrls?.map((entry) => entry.url) ?? []),
  ].filter((url): url is string => url !== null);
}

function normalizedHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function checkExcessiveDomainDiversity(
  brand: RecentBrandEdit,
): HealthFinding[] {
  const domains = [
    ...new Set(
      collectBrandUrls(brand)
        .map(normalizedHostname)
        .filter((hostname): hostname is string => hostname !== null),
    ),
  ].sort(compareText);

  if (domains.length <= 5) {
    return [];
  }

  return [
    finding(
      "brand-review-domain-diversity",
      brand,
      "Excessive domain diversity",
      "medium",
      {
        brandId: brand.id,
        brandName: brand.name,
        domainCount: domains.length,
        domains,
      },
    ),
  ];
}

function checkSelfReferentialUrls(brand: RecentBrandEdit): HealthFinding[] {
  const matchedUrl = collectBrandUrls(brand).find(
    (url) => normalizedHostname(url) === "formoria.com",
  );

  if (matchedUrl === undefined) {
    return [];
  }

  return [
    finding(
      "brand-review-self-referential",
      brand,
      "Self-referential formoria.com URL",
      "low",
      {
        brandId: brand.id,
        brandName: brand.name,
        matchedUrl,
      },
    ),
  ];
}

function hostMatches(host: string, candidates: readonly string[]): boolean {
  return candidates.some((c) => host === c || host.endsWith("." + c));
}

function checkPurchaseWebsiteShape(brand: RecentBrandEdit): HealthFinding[] {
  const url = brand.purchaseWebsite;
  if (url === null) return [];

  const host = normalizedHostname(url);
  if (host === null) return [];

  if (hostMatches(host, THIRD_PARTY_DIRECTORY_HOSTS)) {
    return [
      finding(
        "brand-review-purchase-website-third-party",
        brand,
        "purchase_website points at a third-party directory",
        "medium",
        {
          brandId: brand.id,
          brandName: brand.name,
          purchaseWebsite: url,
          hostname: host,
        },
      ),
    ];
  }

  if (hostMatches(host, SOCIAL_HOSTS)) {
    return [
      finding(
        "brand-review-purchase-website-social",
        brand,
        "purchase_website holds a social URL",
        "medium",
        {
          brandId: brand.id,
          brandName: brand.name,
          purchaseWebsite: url,
          hostname: host,
        },
      ),
    ];
  }

  if (host === "formoria.com") {
    return [];
  }
  return [];
}

// Source of truth: getBrandVisitLink in src/lib/brands/link-fallback.ts, backed by
// sanitizeHref/normalizeInstagramHref/normalizeThreadsHref in src/lib/url.ts. This
// tree imports nothing from src/, so the chain is mirrored here — change both sides
// together. Do not mirror hasText in src/lib/services/brand-quality.ts: it counts
// other_urls, which the CTA chain does not.
//
// The mirror is deliberately STRICTER than the real chain in two spots, so it
// over-reports rather than under-reports: it requires the href to be URL-parseable
// (sanitizeHref does not), and it rejects a non-http scheme on the handle fields
// (normalizeInstagramHref would happily synthesize https://instagram.com/mailto:x).
function sanitizedHref(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  return `https://${trimmed}`;
}

function isUsableHref(value: string | null): boolean {
  const href = sanitizedHref(value);
  return href !== null && normalizedHostname(href) !== null;
}

function isUsableHandleHref(value: string | null): boolean {
  if (value === null) return false;
  const trimmed = value.trim();
  if (trimmed === "") return false;
  if (/^https?:\/\//i.test(trimmed)) return isUsableHref(trimmed);
  // Instagram/Threads also accept a bare handle ("@warmwood") and synthesize a
  // profile URL from it; a non-http scheme stays unusable.
  return !/^[a-z][a-z0-9+.-]*:/i.test(trimmed);
}

function checkVisitCtaDisabled(brand: RecentBrandEdit): HealthFinding[] {
  // other_urls is deliberately absent: it is not part of the CTA chain, so a brand
  // with only other_urls entries still renders a disabled visit button.
  const hasUsableChannel =
    isUsableHref(brand.purchaseWebsite) ||
    isUsableHref(brand.purchasePinkoi) ||
    isUsableHref(brand.purchaseShopee) ||
    isUsableHandleHref(brand.socialInstagram) ||
    isUsableHandleHref(brand.socialThreads) ||
    isUsableHref(brand.socialFacebook);

  if (hasUsableChannel) {
    return [];
  }

  return [
    finding(
      "brand-review-visit-cta-disabled",
      brand,
      "Brand has no usable visit CTA",
      "medium",
      {
        brandId: brand.id,
        brandName: brand.name,
      },
    ),
  ];
}

export function evaluateBrandReview(
  brands: readonly RecentBrandEdit[],
  nowIso: string,
  windowStartIso: string,
): { findings: HealthFinding[]; snapshot: BrandReviewSnapshot } {
  const findings = brands
    .flatMap((brand) => [
      ...checkMitConsistency(brand),
      ...checkDescriptionLanguageSwap(brand),
      ...checkExcessiveDomainDiversity(brand),
      ...checkSelfReferentialUrls(brand),
      ...checkPurchaseWebsiteShape(brand),
      ...checkVisitCtaDisabled(brand),
    ])
    .sort((left, right) => compareText(left.fingerprint, right.fingerprint));

  return {
    findings,
    snapshot: {
      reviewedCount: brands.length,
      findingCount: findings.length,
      windowStartIso,
      nowIso,
    },
  };
}
