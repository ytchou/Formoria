import { afterEach, describe, expect, it, vi } from "vitest";

// next.config.ts reads NODE_ENV at module load, so each case re-imports it
// under its own environment.
async function loadConfig(nodeEnv: "production" | "development") {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  // The production branch asserts a Supabase storage host is configured.
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  return (await import("../../next.config")).default;
}

async function scriptSrc(nodeEnv: "production" | "development") {
  const config = await loadConfig(nodeEnv);
  const rules = (await config.headers?.()) ?? [];
  const csp = rules
    .flatMap((rule) => rule.headers)
    .find((header) => header.key === "Content-Security-Policy")?.value;
  return csp
    ?.split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith("script-src "));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("security headers (DEV-1961)", () => {
  it("does not advertise the framework", async () => {
    const config = await loadConfig("production");
    expect(config.poweredByHeader).toBe(false);
  });

  it("drops 'unsafe-eval' from the production script-src", async () => {
    const directive = await scriptSrc("production");
    expect(directive).toContain("'self'");
    expect(directive).not.toContain("'unsafe-eval'");
  });

  it("keeps 'unsafe-eval' in development for React Refresh", async () => {
    expect(await scriptSrc("development")).toContain("'unsafe-eval'");
  });
});

describe("edge TTL for previously fully static pages (DEV-1961)", () => {
  // Without `revalidate`, Next sends `s-maxage=31536000`, which the Cloudflare
  // HTML cache rule would honour for a year across deploys.
  it.each([
    ["faq", () => import("../app/[locale]/(site)/faq/page")],
    ["terms", () => import("../app/[locale]/(site)/terms/page")],
    ["privacy", () => import("../app/[locale]/(site)/privacy/page")],
    ["brands/join", () => import("../app/[locale]/(site)/brands/join/page")],
  ])("/%s revalidates hourly", async (_page, load) => {
    expect((await load()).revalidate).toBe(3600);
  });
});
