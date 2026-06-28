import { afterEach, describe, expect, it, vi } from "vitest";
import { getSiteUrl } from "../site-url";

describe("getSiteUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns NEXT_PUBLIC_SITE_URL without a trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://formoria.com/");
    expect(getSiteUrl()).toBe("https://formoria.com");
  });

  it("returns the env value as-is when it has no trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://formoria.com");
    expect(getSiteUrl()).toBe("https://formoria.com");
  });

  it("falls back to localhost when the env var is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(getSiteUrl()).toBe("http://localhost:3000");
  });
});
