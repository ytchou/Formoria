import { describe, expect, it } from "vitest";

import { ANALYTICS_EVENTS } from "./events";
import * as serverSupplyEvents from "./server-supply-events";

const firstPublication = {
  brand_id: "7f6d2e9c-3d5a-4b8a-9c11-1f2a3b4c5d6e",
  brand_slug: "maru-studio",
  is_brand_owner: false,
};

const secondPublication = {
  brand_id: "a1b2c3d4-5e6f-4789-abcd-0123456789ef",
  brand_slug: "rin-craft",
  is_brand_owner: true,
};

describe("brand listing supply event construction", () => {
  it("keeps the service identity private and stable across real publications", () => {
    const firstEvent = serverSupplyEvents.buildBrandListingPublishedEvent(
      "Maru Studio",
      firstPublication,
    );
    const secondEvent = serverSupplyEvents.buildBrandListingPublishedEvent(
      "Rin Craft",
      secondPublication,
    );

    expect(serverSupplyEvents).not.toHaveProperty(
      "BRAND_LISTING_PUBLISHED_SERVICE_DISTINCT_ID",
    );
    expect(firstEvent).toEqual({
      distinctId: "formoria:service:brand-listing-publisher",
      event: ANALYTICS_EVENTS.BRAND_LISTING_PUBLISHED,
      properties: {
        ...firstPublication,
        $process_person_profile: false,
      },
    });
    expect(secondEvent).toEqual({
      distinctId: firstEvent?.distinctId,
      event: ANALYTICS_EVENTS.BRAND_LISTING_PUBLISHED,
      properties: {
        ...secondPublication,
        $process_person_profile: false,
      },
    });

    expect(firstEvent?.distinctId).toBe(secondEvent?.distinctId);
  });

  it("drops the event for an E2E fixture publication", () => {
    expect(
      serverSupplyEvents.buildBrandListingPublishedEvent(
        "[E2E-TEST] signup fixture",
        firstPublication,
      ),
    ).toBeNull();
  });
});
