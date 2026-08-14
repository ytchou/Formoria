import { describe, expect, it } from "vitest";
import {
  CURATED_LINK_READ_LIFECYCLES,
  CURATED_LINK_WRITE_COLUMNS,
  applyLinkStates,
  classify,
  groupLinkChecksByTrail,
  loadProducts,
  probe,
  selectReviewDue,
  type LinkCheck,
  type LinkStateWriter,
  type ProductQuery,
  type ProductReader,
  type ProductRow,
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

  /**
   * A bot challenge is NOT evidence of a dead link. A Cloudflare-fronted origin
   * answers a scripted HEAD with 403 and a rate limiter answers 429, while both
   * serve the page perfectly to a real visitor. Recording `broken` there drops
   * the working call-to-action from every product on that origin, on every run.
   *
   * `link_state` has no `blocked` value and its CHECK constraint is already
   * applied to the live database, so the verdict is "no verdict": `linkState`
   * is null and the stored state is left exactly as it was.
   */
  it.each([403, 429, 402, 405])(
    "records no verdict for a blocked status (%i)",
    (status) => {
      const result = classify({
        requestedUrl: "https://hanchor.com/products/alpine-shell",
        resolvedUrl: "https://hanchor.com/products/alpine-shell",
        status,
      });

      expect(result.linkState).toBeNull();
      expect(result.blocked).toBe(true);
      expect(result.status).toBe(status);
    },
  );

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

/* -------------------------------------------------------------------------- */
/* Shell. The network and the database are injected, so nothing here reaches   */
/* either — but the two bugs that shipped (a bot challenge recorded as broken, */
/* a failed revalidation exiting 0) both lived below the pure/shell line, and  */
/* a suite that stops at the classifier cannot see them.                       */
/* -------------------------------------------------------------------------- */

type FetchCall = { url: string; method: string };

function fetchStub(
  responses: { status: number; url?: string }[],
  calls: FetchCall[],
): typeof fetch {
  let index = 0;
  return (async (input: unknown, init?: { method?: string }) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    const response = responses[Math.min(index++, responses.length - 1)]!;
    return { status: response.status, url: response.url ?? url };
  }) as unknown as typeof fetch;
}

describe("probe", () => {
  it("retries with GET when HEAD is refused by method", async () => {
    const calls: FetchCall[] = [];
    const result = await probe(
      "https://hanchor.com/products/alpine-shell",
      // SPA hosts and PHP front controllers routinely answer HEAD 404 and
      // GET 200; a not-found verdict must survive a real visitor's method.
      fetchStub([{ status: 404 }, { status: 200 }], calls),
    );

    expect(calls.map((call) => call.method)).toEqual(["HEAD", "GET"]);
    expect(result.status).toBe(200);
    expect(classify(result).linkState).toBe("ok");
  });

  it("does not retry when HEAD already answers", async () => {
    const calls: FetchCall[] = [];
    const result = await probe(
      "https://hanchor.com/products/alpine-shell",
      fetchStub([{ status: 200 }], calls),
    );

    expect(calls.map((call) => call.method)).toEqual(["HEAD"]);
    expect(result.status).toBe(200);
  });

  it("carries the post-redirect URL through, so a move is distinguishable", async () => {
    const calls: FetchCall[] = [];
    const result = await probe(
      "https://hanchor.com/products/alpine-shell",
      fetchStub(
        [{ status: 200, url: "https://hanchor.com/collections/outerwear" }],
        calls,
      ),
    );

    expect(result.resolvedUrl).toBe("https://hanchor.com/collections/outerwear");
    expect(classify(result).linkState).toBe("redirected");
  });

  it("refuses a private URL without touching the network", async () => {
    const calls: FetchCall[] = [];
    // SSRF guard: an authored official_url pointing at the metadata service or
    // a loopback address must never be fetched by a script holding the service
    // key. `status: null` then classifies as broken, which is the right report.
    const result = await probe(
      "http://127.0.0.1:8080/admin",
      fetchStub([{ status: 200 }], calls),
    );

    expect(calls).toEqual([]);
    expect(result).toEqual({
      requestedUrl: "http://127.0.0.1:8080/admin",
      resolvedUrl: null,
      status: null,
    });
  });
});

describe("applyLinkStates", () => {
  function productRow(overrides: Partial<ProductRow> = {}): ProductRow {
    return {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      brand_id: BRAND_ID,
      key: "alpine-shell",
      name_zh: "高山風衣",
      lifecycle: "published",
      official_url: "https://hanchor.com/products/alpine-shell",
      link_state: "ok",
      review_due_at: null,
      brands: { slug: "hanchor" },
      ...overrides,
    };
  }

  /** Records every write instead of performing one. Injected, never mocked. */
  function recordingWriter() {
    const writes: { table: string; values: Record<string, unknown>; id: string }[] =
      [];
    const client: LinkStateWriter = {
      from: (table) => ({
        update: (values) => ({
          eq: async (_column, value) => {
            writes.push({ table, values, id: value });
            return { error: null };
          },
        }),
      }),
    };
    return { client, writes };
  }

  it("groups link health by every active trail placement", () => {
    const checks: LinkCheck[] = [
      {
        row: productRow({
          curated_product_selections: [
            { trail_slug: "small-space-reading-corner", state: "active" },
            { trail_slug: "gifting", state: "active" },
          ],
        }),
        classification: classify({
          requestedUrl: "https://hanchor.com/products/alpine-shell",
          resolvedUrl: "https://hanchor.com/collections/outerwear",
          status: 301,
        }),
        changed: true,
      },
      {
        row: productRow({
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          key: "trail-cap",
          brands: { slug: "another-brand" },
          curated_product_selections: [
            { trail_slug: "small-space-reading-corner", state: "active" },
          ],
        }),
        classification: classify({
          requestedUrl: "https://another-brand.example/trail-cap",
          resolvedUrl: "https://another-brand.example/trail-cap",
          status: 403,
        }),
        changed: false,
      },
    ];

    expect(groupLinkChecksByTrail(checks)).toEqual([
      {
        trailSlug: "gifting",
        products: 1,
        changed: 1,
        blocked: 0,
        brands: ["hanchor"],
      },
      {
        trailSlug: "small-space-reading-corner",
        products: 2,
        changed: 1,
        blocked: 1,
        brands: ["another-brand", "hanchor"],
      },
    ]);
  });

  it("writes link_state and link_checked_at and nothing else", async () => {
    const { client, writes } = recordingWriter();
    const classification = classify({
      requestedUrl: "https://hanchor.com/products/alpine-shell",
      resolvedUrl: "https://hanchor.com/products/alpine-shell",
      status: 404,
    });
    const check: LinkCheck = {
      row: productRow(),
      classification,
      changed: true,
    };

    await applyLinkStates([check], client);

    expect(writes).toHaveLength(1);
    expect(writes[0]!.table).toBe("curated_products");
    expect(writes[0]!.id).toBe(check.row.id);
    // Every other column on the table is authored — name, rationale,
    // official_url, lifecycle, images, notes. A health run that touched one
    // would overwrite editorial copy with whatever the last read happened to
    // see, so the key set is asserted exactly.
    expect(Object.keys(writes[0]!.values).sort()).toEqual(
      [...CURATED_LINK_WRITE_COLUMNS].sort(),
    );
    expect(writes[0]!.values.link_state).toBe("broken");
    expect(writes[0]!.values.link_checked_at).toBe(classification.checkedAt);
  });

  it("raises the failing product key when the update errors", async () => {
    const client: LinkStateWriter = {
      from: () => ({
        update: () => ({
          eq: async () => ({ error: { message: "permission denied" } }),
        }),
      }),
    };

    await expect(
      applyLinkStates(
        [
          {
            row: productRow(),
            classification: classify({
              requestedUrl: "https://hanchor.com/products/alpine-shell",
              resolvedUrl: null,
              status: null,
            }),
            changed: true,
          },
        ],
        client,
      ),
    ).rejects.toThrow(/alpine-shell.*permission denied/);
  });
});

/**
 * READ SCOPE. Nothing renders a `candidate`, so every candidate probed is a
 * request and an `external_call_audit` row spent for no reader, a `link_state`
 * machine-authored before an editor has looked at the row, and a brand slug
 * dragged into the revalidation set — rebuilding a PUBLIC page for a change it
 * cannot show, with a revalidation failure taking the whole run non-zero.
 *
 * None of that raises an error today, which is exactly why the filter is
 * asserted here rather than left to a reader to notice.
 */
describe("loadProducts read scope", () => {
  type RecordedCall = { method: string; args: unknown[] };

  function readerRow(overrides: Partial<ProductRow> = {}): ProductRow {
    return {
      id: "22222222-2222-4222-8222-222222222222",
      brand_id: BRAND_ID,
      key: "alpine-shell",
      name_zh: "高山風衣",
      lifecycle: "published",
      official_url: "https://hanchor.com/products/alpine-shell",
      link_state: "ok",
      review_due_at: null,
      brands: { slug: "hanchor" },
      ...overrides,
    };
  }

  /**
   * Records the filter chain AND honours it: `range` returns only the rows the
   * recorded lifecycle allow-list admits, so the report assertions below run on
   * what the database would actually have returned.
   */
  function recordingReader(rows: readonly ProductRow[]) {
    const calls: RecordedCall[] = [];
    let allowed: readonly string[] | null = null;

    const query: ProductQuery = {
      in: (column, values) => {
        calls.push({ method: "in", args: [column, [...values]] });
        if (column === "lifecycle") allowed = [...values];
        return query;
      },
      eq: (column, value) => {
        calls.push({ method: "eq", args: [column, value] });
        return query;
      },
      order: (column, options) => {
        calls.push({ method: "order", args: [column, options] });
        return query;
      },
      range: async (from, to) => {
        calls.push({ method: "range", args: [from, to] });
        const data = rows.filter(
          (row) => allowed === null || allowed.includes(row.lifecycle),
        );
        return { data: from === 0 ? data : [], error: null };
      },
    };

    const client: ProductReader = {
      from: (table) => {
        calls.push({ method: "from", args: [table] });
        return {
          select: (columns) => {
            calls.push({ method: "select", args: [columns] });
            return query;
          },
        };
      },
    };

    return { client, calls };
  }

  it("load_products_excludes_candidates", async () => {
    const { client, calls } = recordingReader([
      readerRow(),
      readerRow({ id: "33333333-3333-4333-8333-333333333333", key: "draft-tote", lifecycle: "candidate" }),
      readerRow({ id: "44444444-4444-4444-8444-444444444444", key: "old-cap", lifecycle: "retired" }),
    ]);

    const rows = await loadProducts(null, client);

    // A positive allow-list, so a lifecycle value nobody has considered here
    // defaults to NOT being probed.
    expect(calls).toContainEqual({
      method: "in",
      args: ["lifecycle", ["published", "needs_review"]],
    });
    expect(calls.some((call) => call.method === "neq")).toBe(false);
    expect(rows.map((row) => row.lifecycle)).toEqual(["published"]);
  });

  /**
   * `selectReviewDue` has no lifecycle filter of its own, so the read scope is
   * the only thing keeping unreviewed candidates out of an editor's work queue.
   */
  it("review_due_excludes_candidates", async () => {
    const overdue = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { client } = recordingReader([
      readerRow({ review_due_at: overdue }),
      readerRow({
        id: "33333333-3333-4333-8333-333333333333",
        key: "draft-tote",
        lifecycle: "candidate",
        review_due_at: overdue,
      }),
    ]);

    const rows = await loadProducts(null, client);
    const due = selectReviewDue(
      rows.map((row) => ({
        id: row.id,
        brandId: row.brand_id,
        brandSlug: "hanchor",
        key: row.key,
        nameZh: row.name_zh,
        lifecycle: row.lifecycle,
        linkState: row.link_state,
        reviewDueAt: row.review_due_at,
      })),
    );

    expect(due.map((product) => product.key)).toEqual(["alpine-shell"]);
    expect(due.some((product) => product.lifecycle === "candidate")).toBe(false);
  });

  it("keeps the allow-list and the exported constant in step", () => {
    expect([...CURATED_LINK_READ_LIFECYCLES]).toEqual([
      "published",
      "needs_review",
    ]);
  });

  /**
   * Narrowing the READ must not narrow or widen the WRITE. The updater still
   * writes these two columns and nothing else; every other column is authored.
   */
  it("write_columns_unchanged", () => {
    expect([...CURATED_LINK_WRITE_COLUMNS]).toEqual([
      "link_state",
      "link_checked_at",
    ]);
  });
});
