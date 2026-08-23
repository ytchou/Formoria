/**
 * The storage half of the write blocker. This client is pointed at PRODUCTION
 * by `sync-staging-from-prod.ts`, so the property that matters is that it fails
 * CLOSED: a bucket method nobody enumerated must be refused, not passed through.
 *
 * No Supabase mock here — the repo forbids it, and none is needed. Constructing
 * a client is offline; `createClient` opens no socket until a call is awaited,
 * and every call under test is refused before it would reach the network.
 */
import { describe, expect, it } from "vitest";

import { createWriteBlockingClient } from "../readonly-client";

const URL = "https://example.supabase.co";
const KEY = "test-service-key-not-a-real-credential";

describe("createWriteBlockingClient storage", () => {
  it("passes named reads through to the real bucket", () => {
    const { client } = createWriteBlockingClient(URL, KEY);
    const bucket = client.storage.from("brand-images");

    // `download` and `list` are what the staging sync actually needs.
    expect(typeof bucket.download).toBe("function");
    expect(typeof bucket.list).toBe("function");
  });

  it("refuses and tallies a write", async () => {
    const { client, blocked } = createWriteBlockingClient(URL, KEY);

    const result = await client.storage
      .from("brand-images")
      .upload("brands/x/y.webp", new Blob([]));

    expect(result).toEqual({ data: null, error: null });
    expect(blocked).toEqual([{ table: "storage", method: "upload" }]);
  });

  it("refuses an upload token, which is a delayed write", async () => {
    const { client, blocked } = createWriteBlockingClient(URL, KEY);

    await client.storage
      .from("brand-images")
      .createSignedUploadUrl("brands/x/y.webp");

    expect(blocked).toEqual([
      { table: "storage", method: "createSignedUploadUrl" },
    ]);
  });

  it("fails closed on a method it has never heard of", async () => {
    const { client, blocked } = createWriteBlockingClient(URL, KEY);
    const bucket = client.storage.from("brand-images") as unknown as Record<
      string,
      (...args: unknown[]) => Promise<unknown>
    >;

    // Stands in for a future storage-js release growing a new writing verb.
    // Under a deny-list this would reach production; under the allow-list it
    // is refused. Reflect.get on a real bucket returns undefined for an unknown
    // key, so the proxy's non-function branch is what must NOT swallow it —
    // hence the guard is asserted on a name that does exist and mutates.
    await bucket.move("brands/a.webp", "brands/b.webp");

    expect(blocked).toEqual([{ table: "storage", method: "move" }]);
  });
});
