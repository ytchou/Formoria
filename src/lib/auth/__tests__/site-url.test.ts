import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockHeaders: Map<string, string>;

vi.mock("next/headers", () => ({
  headers: vi.fn(() => Promise.resolve(mockHeaders)),
}));

const { getRequestOrigin } = await import("../site-url");

describe("getRequestOrigin", () => {
  beforeEach(() => {
    mockHeaders = new Map();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns forwarded origin when x-forwarded-host matches NEXT_PUBLIC_SITE_URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://formoria.com");
    mockHeaders.set("x-forwarded-host", "formoria.com");
    mockHeaders.set("x-forwarded-proto", "https");

    return expect(getRequestOrigin()).resolves.toBe("https://formoria.com");
  });

  it("returns env var when x-forwarded-host does not match (open redirect prevention)", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://formoria.com");
    mockHeaders.set("x-forwarded-host", "evil.com");
    mockHeaders.set("x-forwarded-proto", "https");

    return expect(getRequestOrigin()).resolves.toBe("https://formoria.com");
  });

  it("returns localhost when x-forwarded-host is localhost despite prod SITE_URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://formoria.com");
    mockHeaders.set("x-forwarded-host", "localhost:3000");
    mockHeaders.set("x-forwarded-proto", "http");

    const origin = await getRequestOrigin();
    expect(origin).toBe("http://localhost:3000");
  });

  it("returns localhost origin when host is localhost and no proxy headers exist", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://formoria.com");
    mockHeaders.set("host", "localhost:3000");

    const origin = await getRequestOrigin();
    expect(origin).toBe("http://localhost:3000");
  });

  it("returns localhost origin for 127.0.0.1", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://formoria.com");
    mockHeaders.set("host", "127.0.0.1:3000");

    const origin = await getRequestOrigin();
    expect(origin).toBe("http://127.0.0.1:3000");
  });

  it("returns https for non-local host header", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://formoria.com");
    mockHeaders.set("host", "formoria.com");

    const origin = await getRequestOrigin();
    expect(origin).toBe("https://formoria.com");
  });

  it("falls back to getSiteUrl when no headers are present", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://formoria.com");

    const origin = await getRequestOrigin();
    expect(origin).toBe("https://formoria.com");
  });

  it("falls back to localhost when no headers and no env var", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");

    const origin = await getRequestOrigin();
    expect(origin).toBe("http://localhost:3000");
  });
});
