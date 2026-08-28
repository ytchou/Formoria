import { describe, expect, it } from "vitest";

import {
  isLocalRequestUrl,
  resolveSentryEnvironment,
} from "./sentry-environment";

describe("resolveSentryEnvironment", () => {
  it("reports a machine with no deploy marker as local", () => {
    expect(resolveSentryEnvironment({ NODE_ENV: "production" })).toBe("local");
  });

  it("does not inherit NODE_ENV — the whole DEV-1561 failure", () => {
    // `next build` + `next start` on a laptop sets NODE_ENV=production, and
    // .env.local carries the production DSN and site URL. Nothing about the
    // request distinguishes it except the absence of a Railway variable.
    expect(
      resolveSentryEnvironment({
        NODE_ENV: "production",
        NEXT_PUBLIC_SITE_URL: "https://formoria.com",
      }),
    ).toBe("local");
  });

  it("uses the Railway environment name when the platform injects it", () => {
    expect(
      resolveSentryEnvironment({
        NODE_ENV: "production",
        RAILWAY_ENVIRONMENT_NAME: "production",
      }),
    ).toBe("production");
  });

  it("keeps staging distinct from production", () => {
    expect(
      resolveSentryEnvironment({ RAILWAY_ENVIRONMENT_NAME: "staging" }),
    ).toBe("staging");
  });

  it("reads the client-bundle mirror of the Railway name", () => {
    expect(
      resolveSentryEnvironment({
        NEXT_PUBLIC_RAILWAY_ENVIRONMENT_NAME: "production",
      }),
    ).toBe("production");
  });

  it("lets an explicit SENTRY_ENVIRONMENT override the platform", () => {
    expect(
      resolveSentryEnvironment({
        RAILWAY_ENVIRONMENT_NAME: "production",
        SENTRY_ENVIRONMENT: "canary",
      }),
    ).toBe("canary");
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(
      resolveSentryEnvironment({ RAILWAY_ENVIRONMENT_NAME: "  Production " }),
    ).toBe("production");
  });

  it("treats a blank marker as absent rather than as an environment name", () => {
    expect(
      resolveSentryEnvironment({
        RAILWAY_ENVIRONMENT_NAME: "   ",
        SENTRY_ENVIRONMENT: "",
      }),
    ).toBe("local");
  });
});

describe("isLocalRequestUrl", () => {
  it("matches the harness URL from the FORMORIA-2H events", () => {
    expect(
      isLocalRequestUrl("http://localhost:3123/style/small-space-reading-corner"),
    ).toBe(true);
  });

  it.each([
    "http://127.0.0.1:3000/brands",
    "http://[::1]:3000/brands",
    "http://0.0.0.0:3000/brands",
    "http://macbookpro.local:3000/brands",
    "http://app.localhost:3000/brands",
  ])("matches %s", (url) => {
    expect(isLocalRequestUrl(url)).toBe(true);
  });

  it.each([
    "https://formoria.com/style/small-space-reading-corner",
    "https://formoria.com/admin/submissions",
  ])("does not match real production traffic at %s", (url) => {
    expect(isLocalRequestUrl(url)).toBe(false);
  });

  it("does not match a production host that merely contains the word", () => {
    expect(isLocalRequestUrl("https://localhost.formoria.com/brands")).toBe(false);
  });

  it("returns false for a missing or unparseable url", () => {
    expect(isLocalRequestUrl(undefined)).toBe(false);
    expect(isLocalRequestUrl("not a url")).toBe(false);
  });
});
