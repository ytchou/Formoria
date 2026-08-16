import { describe, expect, it } from "vitest";

import {
  backfillImageDimensions,
  loadRowsNeedingDimensions,
  parseApplyOption,
  type DimensionQuery,
  type DimensionRow,
  type DimensionUpdateFilter,
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
    brands: { slug: "reading-lamp-co" },
    ...overrides,
  };
}

function recordingWriter(): {
  writer: DimensionWriter;
  writes: {
    id: string;
    values: Record<string, unknown>;
    filters: [string, string][];
  }[];
} {
  const writes: {
    id: string;
    values: Record<string, unknown>;
    filters: [string, string][];
  }[] = [];
  const writer: DimensionWriter = {
    from() {
      return {
        update(values: Record<string, unknown>) {
          const filters: [string, string][] = [];
          // `eq` chains and is itself awaitable, exactly like PostgREST's
          // builder: the update is keyed on the id AND the image_url.
          const build = (): DimensionUpdateFilter => {
            const filter = {
              eq(column: string, value: string) {
                filters.push([column, value]);
                return build();
              },
              then(resolve: (result: { error: null }) => unknown) {
                writes.push({
                  id: filters.find(([column]) => column === "id")?.[1] ?? "",
                  values,
                  filters: [...filters],
                });
                return Promise.resolve({ error: null }).then(resolve);
              },
            };
            return filter as unknown as DimensionUpdateFilter;
          };
          return build();
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

  it("re-measures rows that already have dimensions when forced", async () => {
    const { writer, writes } = recordingWriter();

    const report = await backfillImageDimensions({
      rows: [
        row({ id: "row-stale", key: "stale", image_width: 1200, image_height: 800 }),
      ],
      apply: true,
      force: true,
      writer,
      measure: async () => ({ width: 1000, height: 1000 }),
    });

    // Without the force flag threaded here, the pending filter skipped every
    // forced row and the run reported {selected: 1, skipped: 1, written: 0}.
    expect(report.skipped).toBe(0);
    expect(report.measured).toBe(1);
    expect(report.written).toBe(1);
    expect(writes[0]?.values).toEqual({ image_width: 1000, image_height: 1000 });
  });

  it("keys the write on the image_url it measured", async () => {
    const { writer, writes } = recordingWriter();

    const report = await backfillImageDimensions({
      rows: [row({ id: "row-a", key: "a" })],
      apply: true,
      writer,
      measure: async () => ({ width: 1200, height: 900 }),
    });

    // An id-only update would clobber the fresher dimensions an admin's
    // mid-run image replacement already wrote.
    expect(writes[0]?.filters).toEqual([
      ["id", "row-a"],
      ["image_url", `${IMAGE_BASE}/curated-products/lamp.webp`],
    ]);
    expect(report.writtenBrandSlugs).toEqual(["reading-lamp-co"]);
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
  function recordingQuery() {
    const calls: {
      table: string;
      select: string[];
      is: [string, unknown][];
      not: [string, string, unknown][];
      order: string[];
    } = { table: "", select: [], is: [], not: [], order: [] };

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

    return {
      calls,
      reader: {
        from(table: string) {
          calls.table = table;
          return {
            select: (columns: string) => {
              calls.select.push(columns);
              return query;
            },
          };
        },
      },
    };
  }

  it("drops the null cursor under --force so populated rows are re-read", async () => {
    const { calls, reader } = recordingQuery();

    await loadRowsNeedingDimensions(true, reader);

    expect(calls.is).not.toContainEqual(["image_width", null]);
    expect(calls.not).toContainEqual(["image_url", "is", null]);
  });

  it("embeds the brand slug so an apply can revalidate what it changed", async () => {
    const { calls, reader } = recordingQuery();

    await loadRowsNeedingDimensions(false, reader);

    expect(calls.select[0]).toContain("brands!inner(slug)");
  });

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
