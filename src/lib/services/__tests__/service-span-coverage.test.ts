import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditRecord } from "@/lib/audit";

const ORIGINAL_SUPABASE_URL = "https://supabase.example.test";
const BRAND_ID = "7a0d4e7c-2a1b-4f20-9d63-3a8f0c5e4b11";
const USER_ID = "4b6c8f12-3d5e-47a9-b021-6e8d7f4a2c90";
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function brandRow() {
  return {
    id: BRAND_ID,
    name: "María García Studio",
    slug: "maria-garcia-studio",
    status: "approved",
  };
}

function imageInsertClient() {
  return {
    from: () => ({
      insert: async () => ({ error: null }),
    }),
  };
}

async function runMutations(): Promise<void> {
  const { saveBrand } = await import("../saved-brands");
  const { insertBrandImage } = await import("../brand-images");

  await saveBrand(USER_ID, BRAND_ID);
  await insertBrandImage(imageInsertClient(), {
    brand_id: BRAND_ID,
    storage_path: "brands/maria-garcia-studio/hero.webp",
    source: "owner",
  });
}

describe("service span coverage", () => {
  let writes: AuditRecord[];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    writes = [];
    const { setAuditWriteSeam } = await import("@/lib/audit");
    setAuditWriteSeam(async (record) => {
      writes.push(record);
      return null;
    });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ORIGINAL_SUPABASE_URL);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.includes("/rest/v1/brand_saves")) {
        return jsonResponse([]);
      }
      return jsonResponse([brandRow()]);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    const { resetAuditEmitterForTests } = await import("@/lib/audit");
    resetAuditEmitterForTests();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("every instrumented function emits kind='service'", async () => {
    await runMutations();

    expect(writes.length).toBeGreaterThanOrEqual(4);
    expect(new Set(writes.map((record) => record.provider))).toEqual(
      new Set(["brands", "images"]),
    );
    expect(writes.every((record) => record.kind === "service")).toBe(true);
    expect(writes.some((record) => record.kind === "external")).toBe(false);
  });

  it("read-path functions emit no success span", async () => {
    const { getBrandBySlug } = await import("../brands");

    await expect(getBrandBySlug("maria-garcia-studio")).resolves.toMatchObject({
      slug: "maria-garcia-studio",
    });

    expect(writes).toEqual([]);
  });

  it("a failing mutation writes a failed span and rethrows", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { createServiceClient } = await import("@/lib/supabase/service");
    let expectedMessage = "";
    try {
      createServiceClient();
    } catch (error) {
      expectedMessage = error instanceof Error ? error.message : String(error);
    }
    expect(expectedMessage).not.toBe("");

    const { deleteBrand } = await import("../brands");
    await expect(deleteBrand(ZERO_UUID)).rejects.toThrow(expectedMessage);

    expect(writes.at(-1)).toMatchObject({
      kind: "service",
      status: "failed",
      errorMessage: expectedMessage,
    });
  });
});
