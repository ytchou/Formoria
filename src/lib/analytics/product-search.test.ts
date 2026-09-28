import { afterEach, expect, it } from "vitest";
import { registerPostHogProvider, clearPostHogProviderForTests } from "./posthog-provider";
import { sanitizePostHogEvent } from "./posthog-privacy";
import { trackProductSearchEmpty, trackProductSearchBrandClicked, trackProductSearchExecuted } from "../analytics";

afterEach(() => clearPostHogProviderForTests());

it("preserves safe search attribution, empty results and brand clicks through privacy sanitization", () => {
  const events: unknown[] = [];
  registerPostHogProvider({ capture: (event, properties) => { events.push(sanitizePostHogEvent({ event, properties: properties ?? {} })); }, identify() {}, reset() {} });
  trackProductSearchExecuted("春池", 0, { searchSource: "nav", degraded: false, searchId: "spring-pool-search" });
  trackProductSearchEmpty("春池", "spring-pool-search");
  trackProductSearchBrandClicked({ query: "春池", searchId: "spring-pool-search", brandSlug: "spring-pool", position: 0 });
  expect(events).toEqual([
    expect.objectContaining({ event: "product_search_executed", properties: expect.objectContaining({ search_source: "nav", result_count: 0 }) }),
    expect.objectContaining({ event: "product_search_empty", properties: expect.objectContaining({ search_term: "春池", search_id: "spring-pool-search" }) }),
    expect.objectContaining({ event: "product_search_brand_clicked", properties: expect.objectContaining({ search_term: "春池", search_id: "spring-pool-search", brand_slug: "spring-pool", position: 0 }) }),
  ]);
  expect(JSON.stringify(events)).not.toContain('"query":');
  expect(JSON.stringify(events)).not.toContain('"brand_name":');
});
