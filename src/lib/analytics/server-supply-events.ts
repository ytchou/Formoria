import { ANALYTICS_EVENTS, type AnalyticsEventPayloads } from "./events";
import { TEST_BRAND_NAME_PREFIX } from "@/lib/services/public-brand-filter";

/** One stable PostHog identity for inventory telemetry; it must never become a person. */
const BRAND_LISTING_PUBLISHED_SERVICE_DISTINCT_ID =
  "formoria:service:brand-listing-publisher";

type BrandListingPublishedProperties =
  AnalyticsEventPayloads[typeof ANALYTICS_EVENTS.BRAND_LISTING_PUBLISHED];

type BrandListingPublishedInput = Omit<
  BrandListingPublishedProperties,
  "$process_person_profile"
>;

type BrandListingPublishedEvent = {
  distinctId: typeof BRAND_LISTING_PUBLISHED_SERVICE_DISTINCT_ID;
  event: typeof ANALYTICS_EVENTS.BRAND_LISTING_PUBLISHED;
  properties: BrandListingPublishedProperties;
};

/**
 * Builds the server-only publication event after approval. E2E fixture brands
 * are intentionally silent so test data cannot enter production analytics.
 */
export function buildBrandListingPublishedEvent(
  brandName: string,
  payload: BrandListingPublishedInput,
): BrandListingPublishedEvent | null {
  if (brandName.startsWith(TEST_BRAND_NAME_PREFIX)) return null;

  return {
    distinctId: BRAND_LISTING_PUBLISHED_SERVICE_DISTINCT_ID,
    event: ANALYTICS_EVENTS.BRAND_LISTING_PUBLISHED,
    properties: {
      ...payload,
      $process_person_profile: false,
    },
  };
}
