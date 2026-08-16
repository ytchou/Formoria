import { describe, expect, it } from "vitest";

import {
  backfillImageDimensions,
  loadRowsNeedingDimensions,
  parseApplyOption,
  type DimensionQuery,
  type DimensionRow,
  type DimensionWriter,
} from "../backfill-image-dimensions";

/**
 * The dimension backfill (DEV-1479).
 *
 * Every seam is injected as an argument — `scripts/check-test-boundaries.mjs`
 * forbids vi.mock of `@/lib/services/` and `@/lib/supabase/`, and the script
 * takes its reader, its writer and its measurer as parameters for exactly this
 * reason.
 */

const IMAGE_BASE = "https://cdn.example.com/storage/v1/object/public/brand-images";

function row(overrides: Partial<DimensionRow> = {}): DimensionRow {
  return {
    id: "3f6c2a1b-0d54-4e19-9a77-2b5c8e1d4f30",
    key: "reading-lamp",
    image_url: `${IMAGE_BASE}/curated-products/lamp.webp`,
    image_source_url: null,
    image_width: null,
    image_height: null,
    ...overrides,
  };
}

function recordingWriter(): {
  writer: DimensionWriter;
  writes: { id: string; values: Record<string, unknown> }[];
} {
  const writes: { id: string; values: Record<string, unknown> }[] = [];
  const writer: DimensionWriter = {
    from() {
      return {
        update(values: Record<string, unknown>) {
          return {
            async eq(_column: string, value: string) {
              writes.push({ id: value, values });
              return { error: null };
            },
          };
        },
      };
    },
  };
  return { writer, writes };
}

describe("backfillImageDimensions", () => {
  it("dry run writes nothing", async () => {
    const { writer, writes } = recordingWriter();

    const report = await backfillImageDimensions({
      rows: [row({ id: "row-a", key: "a" }), row({ id: "row-b", key: "b" })],
      apply: false,
      writer,
      measure: async () => ({ width: 1200, height: 900 }),
    });

    expect(report.measured).toBe(2);
    // Reported, not written: the operator reads the intent before spending a
    // write on 90 rows.
    expect(report.intended).toBe(2);
    expect(report.written).toBe(0);
    expect(writes).toEqual([]);
  });

  it("reads dimensions from the stored object", async () => {
    const { writer } = recordingWriter();
    const fetched: string[] = [];

    await backfillImageDimensions({
      rows: [
        row({
          image_url: `${IMAGE_BASE}/curated-products/stored.webp`,
          // Present and DIFFERENT on purpose: the source is the bytes an origin
          // once served, not the bytes this site renders — and it is NULL on
          // every fixture row today, so a source-based backfill does nothing.
          image_source_url: "https://brand.example.com/original.jpg",
        }),
      ],
      apply: true,
      writer,
      measure: async (url) => {
        fetched.push(url);
        return { width: 800, height: 1000 };
      },
    });

    expect(fetched).toEqual([`${IMAGE_BASE}/curated-products/stored.webp`]);
    expect(fetched).not.toContain("https://brand.example.com/original.jpg");
  });

  it("skips rows that already have both dimensions", async () => {
    const { writer, writes } = recordingWriter();
    const fetched: string[] = [];

    const report = await backfillImageDimensions({
      rows: [
        row({ id: "row-done", key: "done", image_width: 1200, image_height: 800 }),
        row({ id: "row-todo", key: "todo" }),
      ],
      apply: true,
      writer,
      measure: async (url) => {
        fetched.push(url);
        return { width: 1000, height: 1000 };
      },
    });

    expect(fetched).toHaveLength(1);
    expect(report.skipped).toBe(1);
    expect(writes.map((write) => write.id)).toEqual(["row-todo"]);
  });

  it("records a failure and continues when one object is unreadable", async () => {
    const { writer, writes } = recordingWriter();

    const report = await backfillImageDimensions({
      rows: [
        row({ id: "row-a", key: "a" }),
        row({ id: "row-bad", key: "bad" }),
        row({ id: "row-c", key: "c" }),
      ],
      apply: true,
      writer,
      measure: async (_url, id) => {
        if (id === "row-bad") throw new Error("storage object is gone");
        return { width: 1200, height: 900 };
      },
    });

    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toContain("row-bad");
    expect(report.measured).toBe(2);
    expect(writes.map((write) => write.id).sort()).toEqual(["row-a", "row-c"]);
    expect(writes[0]?.values).toEqual({ image_width: 1200, image_height: 900 });
  });
});

describe("loadRowsNeedingDimensions", () => {
  it("resumes on the null width cursor and pages in a stable order", async () => {
    const calls: {
      table: string;
      is: [string, unknown][];
      not: [string, string, unknown][];
      order: string[];
    } = { table: "", is: [], not: [], order: [] };

    const query: DimensionQuery = {
      is(column: string, value: unknown) {
        calls.is.push([column, value]);
        return query;
      },
      not(column: string, operator: string, value: unknown) {
        calls.not.push([column, operator, value]);
        return query;
      },
      order(column: string) {
        calls.order.push(column);
        return query;
      },
      async range() {
        return { data: [], error: null };
      },
    };

    await loadRowsNeedingDimensions(false, {
      from(table: string) {
        calls.table = table;
        return { select: () => query };
      },
    });

    expect(calls.table).toBe("curated_products");
    expect(calls.is).toContainEqual(["image_width", null]);
    expect(calls.not).toContainEqual(["image_url", "is", null]);
    expect(calls.order).toContain("id");
  });
});

describe("parseApplyOption", () => {
  it("defaults to a dry run", () => {
    expect(parseApplyOption([])).toBe(false);
    expect(parseApplyOption(["--apply"])).toBe(true);
  });
});
