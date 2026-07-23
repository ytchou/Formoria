import {
  stableFingerprint,
  type HealthFinding,
  type JsonValue,
} from "./contracts";

export interface RecentBrandEdit {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly descriptionEn: string | null;
  readonly mitStatus: "unverified" | "declared" | "verified" | null;
  readonly mitDeclaredScope: "all" | "most" | "some" | null;
  readonly mitDeclaredAt: string | null;
  readonly mitVerifiedAt: string | null;
  readonly purchaseWebsite: string | null;
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

function compareText(left: string, right: string): number {
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

function checkDescriptionLanguageSwap(
  brand: RecentBrandEdit,
): HealthFinding[] {
  if (brand.description === null && brand.descriptionEn === null) {
    return [];
  }

  const descriptionCjkCount = countCjkCharacters(brand.description);
  const descriptionEnCjkCount = countCjkCharacters(brand.descriptionEn);
  const evidence = {
    brandId: brand.id,
    brandName: brand.name,
    descriptionCjkCount,
    descriptionEnCjkCount,
  };

  if (descriptionCjkCount === 0 && descriptionEnCjkCount >= 3) {
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

  if (descriptionCjkCount >= 3 && descriptionEnCjkCount >= 3) {
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
