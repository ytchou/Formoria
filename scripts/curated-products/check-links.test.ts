import { describe, expect, it } from "vitest";
import {
  CURATED_LINK_WRITE_COLUMNS,
  classify,
  selectReviewDue,
  type ReviewDueCandidate,
} from "./check-links";

const BRAND_ID = "11111111-1111-4111-8111-111111111111";

/**
 * Every case here runs the classifier on a literal `{ requestedUrl,
 * resolvedUrl, status }` — no `fetch`, no server, no network. That is the whole
 * point of splitting the pure classifier from the fetching shell: the rules
 * that decide a product's `link_state` are the part worth pinning, and a test
 * that needs a live origin to pin them would be pinning the origin instead.
 */
describe("classify", () => {
  it("classifies a 200 response as ok", () => {
    const before = Date.now();
    const result = classify({
      requestedUrl: "https://hanchor.com/products/alpine-shell",
      resolvedUrl: "https://hanchor.com/products/alpine-shell",
      status: 200,
    });

    expect(result.linkState).toBe("ok");
    expect(result.status).toBe(200);

    // link_checked_at records WHEN we learned this, so a stale timestamp on an
    // ok row is indistinguishable from a link nobody has looked at in a year.
    const checkedAt = Date.parse(result.checkedAt);
    expect(Number.isNaN(checkedAt)).toBe(false);
    expect(checkedAt).toBeGreaterThanOrEqual(before);
    expect(checkedAt).toBeLessThanOrEqual(Date.now());
  });

  it("classifies a 404 as broken", () => {
    const result = classify({
      requestedUrl: "https://hanchor.com/products/retired-pack",
      resolvedUrl: "https://hanchor.com/products/retired-pack",
      status: 404,
    });

    expect(result.linkState).toBe("broken");
    expect(result.redirectedTo).toBeNull();
  });

  it("classifies a 3xx landing on a different path as redirected, not broken", () => {
    const result = classify({
      requestedUrl: "https://hanchor.com/products/alpine-shell",
      resolvedUrl: "https://hanchor.com/collections/outerwear",
      status: 301,
    });

    // `redirected` keeps the call-to-action and flags the row for an editor. A
    // moved product still sells; calling it broken would delete a live link.
    expect(result.linkState).toBe("redirected");
    expect(result.redirectedTo).toBe(
      "https://hanchor.com/collections/outerwear",
    );

    // The same landing, seen through a followed redirect (final status 200),
    // must reach the same verdict — otherwise the verdict depends on whether
    // the fetch shell followed redirects rather than on where the URL lands.
    expect(
      classify({
        requestedUrl: "https://hanchor.com/products/alpine-shell",
        resolvedUrl: "https://hanchor.com/collections/outerwear",
        status: 200,
      }).linkState,
    ).toBe("redirected");
  });

  it("classifies a 3xx landing on the same path as ok", () => {
    const trailingSlash = classify({
      requestedUrl: "https://hanchor.com/products/alpine-shell",
      resolvedUrl: "https://hanchor.com/products/alpine-shell/",
      status: 301,
    });
    const protocolAndHost = classify({
      requestedUrl: "http://www.hanchor.com/products/alpine-shell",
      resolvedUrl: "https://hanchor.com/products/alpine-shell",
      status: 308,
    });

    for (const result of [trailingSlash, protocolAndHost]) {
      expect(result.linkState).toBe("ok");
      expect(result.redirectedTo).toBeNull();
    }
  });

  it("never infers stock or availability from a working page", () => {
    const result = classify({
      requestedUrl: "https://hanchor.com/products/alpine-shell",
      resolvedUrl: "https://hanchor.com/products/alpine-shell",
      status: 200,
    });

    // A 200 proves the page resolves. It does not prove the product is in
    // stock, priced as before, or still sold at all — those are commercial
    // facts with a freshness obligation this data model deliberately refuses.
    const forbidden =
      /stock|availab|price|inventor|offer|quantit|sold|purchas/i;
    for (const key of Object.keys(result)) {
      expect(key).not.toMatch(forbidden);
    }
    expect(JSON.stringify(result)).not.toMatch(forbidden);

    // The write set is the same guarantee at the DB boundary: a health run
    // touches link columns only, never an authored one.
    expect([...CURATED_LINK_WRITE_COLUMNS]).toEqual([
      "link_state",
      "link_checked_at",
    ]);
  });
});

describe("selectReviewDue", () => {
  it("lists products past their review_due_at", () => {
    const now = new Date("2026-08-13T00:00:00.000Z");
    const candidates: ReviewDueCandidate[] = [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        brandId: BRAND_ID,
        brandSlug: "hanchor",
        key: "alpine-shell",
        nameZh: "高山風衣",
        lifecycle: "published",
        linkState: "ok",
        reviewDueAt: "2026-05-01T00:00:00.000Z",
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        brandId: BRAND_ID,
        brandSlug: "hanchor",
        key: "trail-cap",
        nameZh: "山徑帽",
        lifecycle: "published",
        linkState: "ok",
        // Due later today, so not yet overdue: the boundary belongs to the
        // future side, or a quarterly cadence reports every product a day early.
        reviewDueAt: "2026-08-13T09:00:00.000Z",
      },
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        brandId: BRAND_ID,
        brandSlug: "hanchor",
        key: "field-tote",
        nameZh: "田野托特包",
        lifecycle: "published",
        linkState: "broken",
        reviewDueAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        brandId: BRAND_ID,
        brandSlug: "hanchor",
        key: "no-cadence-yet",
        nameZh: "尚未排程",
        lifecycle: "candidate",
        linkState: "unchecked",
        // Never scheduled. An unscheduled product is not overdue; it is a
        // separate authoring gap, and folding it in here would bury the real
        // overdue list under every candidate row.
        reviewDueAt: null,
      },
    ];

    const due = selectReviewDue(candidates, now);

    // Oldest first: the report is a work queue, so the most overdue leads.
    expect(due.map((product) => product.key)).toEqual([
      "alpine-shell",
      "field-tote",
    ]);
    expect(due[0]?.daysOverdue).toBe(104);
    expect(due.every((product) => product.reviewDueAt !== null)).toBe(true);
  });
});
