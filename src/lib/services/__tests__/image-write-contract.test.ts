import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * DEV-1551 task 12: nothing writes an image `url` column any more.
 *
 * A SOURCE-level guard, deliberately. Every one of the five writers builds its
 * own Supabase client inside the function, and mocking `@supabase/…` or
 * `@/lib/services/…` is forbidden by `scripts/check-test-boundaries.mjs` — so
 * there is no seam through which a behavioural test could observe the insert
 * payload. The same technique guards CJK in comments, for the same reason:
 * `tsc` and ESLint are both blind to this, and a regression here is invisible
 * until a public storage URL shows up in a page.
 *
 * The `url` COLUMNS STAY in the schema (seven Postgres functions read them, two
 * hand-patched with no source file). Only the writes are gone.
 */

const SERVICES = path.join(process.cwd(), "src/lib/services");

function read(relativePath: string): string {
  return readFileSync(path.join(SERVICES, relativePath), "utf8");
}

/** Strips block and line comments so a prose mention is not a false positive. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\n]*?\/\/[^\n]*$/gm, "");
}

const WRITERS = [
  "image-upload.ts",
  "image-download.ts",
  "brand-images.ts",
  "curated-product-image.ts",
  "submissions.ts",
  "admin-brand-review.ts",
] as const;

describe("image write contract (DEV-1551 task 12)", () => {
  it("upload writes storage_path and not url", () => {
    const source = withoutComments(read("image-upload.ts"));

    // The public-URL lookup is what made a `url` write possible at all.
    expect(source).not.toContain("getPublicUrl");
    // The upload seam returns the bucket key.
    expect(source).toContain("Promise<{ path: string }>");
  });

  it("download writes storage_path and not url", () => {
    const source = withoutComments(read("image-download.ts"));

    expect(source).not.toContain("getPublicUrl");
    expect(source).toContain("storage_path: filename");
    // `publicUrl` was the only value ever written into the `url` column here.
    expect(source).not.toContain("publicUrl");
  });

  it("admin submission-image insert omits url", () => {
    const source = withoutComments(read("submissions.ts"));

    // The staged-image insert carries the key and the source key, never a url.
    expect(source).toContain("storage_path: input.storagePath");
    expect(source).not.toContain("url: input.url");
  });

  it("admin brand-image insert omits url", () => {
    const source = withoutComments(read("admin-brand-review.ts"));

    expect(source).toContain("storage_path: input.storagePath");
    expect(source).not.toContain("url: input.url");
  });

  it("no writer selects the legacy url column alongside storage_path", () => {
    for (const writer of WRITERS) {
      // `admin-brand-review.ts` is the one exemption, and it is a READ. Rows
      // from the 20260708100000 backfill carry `storage_path` NULL and are
      // addressable only through `url`; without it the reject path yielded an
      // empty list and the row stayed active while the UI reported success.
      // The write side is guarded below instead.
      if (writer === "admin-brand-review.ts") continue;
      expect(withoutComments(read(writer)), writer).not.toContain(
        "storage_path, url",
      );
    }
  });

  it("admin brand review strips the legacy url before upserting a row", () => {
    const source = withoutComments(read("admin-brand-review.ts"));

    // A bare `...row` spread of a selected row would put `url` straight back
    // into the upsert payload.
    expect(source).toContain("toPersistableRow(row)");
    expect(source).not.toContain("...row,");
  });

  it("no service builds a public storage URL except the prefix helper", () => {
    // `image-upload.ts` keeps one: the READ-path key recovery for rows written
    // before the flip still has to recognise the old URL shape.
    for (const writer of WRITERS) {
      if (writer === "image-upload.ts") continue;
      expect(withoutComments(read(writer)), writer).not.toContain(
        "storage/v1/object/public",
      );
    }
  });
});
