import { describe, expect, it, vi } from "vitest";
import type { createServiceClient } from "@/lib/supabase/service";
import { fetchEventExhibitors, fetchPublishedEventBySlug } from "../events";

/**
 * What an event query puts in the message it throws. On 2026-08-21 the only
 * thing that reached Sentry was "column brands.product_type does not exist":
 * Postgres had put the actionable fix in `hint`, and the throw dropped it. The
 * `console.error` beside each throw logs the whole object, but stdout is not
 * where the alert is read.
 *
 * A hand-rolled query-builder double rather than a module mock of
 * `@/lib/supabase/*`, which `scripts/check-test-boundaries.mjs` forbids.
 */
type QueryError = { message: string; code?: string; hint?: string };

function failingClient(error: QueryError) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "eq", "order", "range", "in", "filter"]) {
    builder[method] = chain;
  }
  builder.maybeSingle = () => Promise.resolve({ data: null, error });
  builder.then = (
    resolve: (result: { data: null; error: QueryError }) => unknown,
  ) => Promise.resolve(resolve({ data: null, error }));

  return { from: () => builder } as unknown as ReturnType<
    typeof createServiceClient
  >;
}

async function messageFrom(run: () => Promise<unknown>): Promise<string> {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await run();
  } catch (thrown) {
    return thrown instanceof Error ? thrown.message : String(thrown);
  } finally {
    consoleError.mockRestore();
  }
  throw new Error("expected the query error to throw");
}

describe("fetchPublishedEventBySlug thrown message", () => {
  it("includes the PostgREST code in the thrown message", async () => {
    const message = await messageFrom(() =>
      fetchPublishedEventBySlug(
        failingClient({
          code: "42703",
          message: "column events.product_type does not exist",
        }),
        "2026-taiwan-creative-expo",
      ),
    );

    expect(message).toContain("42703");
  });

  it("includes the hint when Postgres supplies one", async () => {
    const message = await messageFrom(() =>
      fetchPublishedEventBySlug(
        failingClient({
          code: "42703",
          message: "column events.product_type does not exist",
          hint: 'Perhaps you meant to reference the column "events.product_types".',
        }),
        "2026-taiwan-creative-expo",
      ),
    );

    expect(message).toContain("events.product_types");
  });

  it("still names the operation and the slug", async () => {
    // The prefix is what existing log greps and `summarizeUpstreamHtmlError`
    // match on, so the change stays additive.
    const message = await messageFrom(() =>
      fetchPublishedEventBySlug(
        failingClient({ code: "42703", message: "boom" }),
        "2026-taiwan-creative-expo",
      ),
    );

    expect(message).toContain(
      "Failed to fetch event 2026-taiwan-creative-expo:",
    );
  });

  it("degrades cleanly when code and hint are absent", async () => {
    const message = await messageFrom(() =>
      fetchPublishedEventBySlug(
        failingClient({ message: "connection reset" }),
        "2026-taiwan-creative-expo",
      ),
    );

    expect(message).toBe(
      "Failed to fetch event 2026-taiwan-creative-expo: connection reset",
    );
    expect(message).not.toContain("undefined");
  });
});

describe("fetchAllPages thrown message", () => {
  // The paged reads share one throw, so its prefix comes from the caller's
  // `failure` argument. Covered once, through the exhibitor roster.
  it("carries the code and hint under the caller's own prefix", async () => {
    const message = await messageFrom(() =>
      fetchEventExhibitors(
        failingClient({
          code: "42703",
          message: "column event_exhibitors.booth does not exist",
          hint: 'Perhaps you meant to reference the column "event_exhibitors.booth_code".',
        }),
        "2026-taiwan-creative-expo",
      ),
    );

    expect(message).toContain(
      "Failed to fetch exhibitors for 2026-taiwan-creative-expo:",
    );
    expect(message).toContain("42703");
    expect(message).toContain("event_exhibitors.booth_code");
  });

  it("degrades cleanly when code and hint are absent", async () => {
    const message = await messageFrom(() =>
      fetchEventExhibitors(
        failingClient({ message: "connection reset" }),
        "2026-taiwan-creative-expo",
      ),
    );

    expect(message).toBe(
      "Failed to fetch exhibitors for 2026-taiwan-creative-expo: connection reset",
    );
    expect(message).not.toContain("undefined");
  });
});
