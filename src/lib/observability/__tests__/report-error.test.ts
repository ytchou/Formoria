import { beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setContext: vi.fn(),
  getClient: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => sentry);

import {
  isReportingEnabled,
  reportError,
  reportMessage,
  setReportContext,
} from "../report-error";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reportError", () => {
  it("passes no capture context when called without options", () => {
    const err = new Error("boom");
    reportError(err);
    expect(sentry.captureException).toHaveBeenCalledWith(err);
    expect(sentry.captureException.mock.calls[0]).toHaveLength(1);
  });

  it("passes no capture context for an empty options object", () => {
    reportError(new Error("boom"), {});
    expect(sentry.captureException.mock.calls[0]).toHaveLength(1);
  });

  it("maps area to the area tag, merged over tags", () => {
    const err = new Error("boom");
    reportError(err, { area: "page-data-read", tags: { scope: "brands" } });
    expect(sentry.captureException).toHaveBeenCalledWith(err, {
      tags: { scope: "brands", area: "page-data-read" },
    });
  });

  it("passes tags, level, extra, fingerprint and contexts through unchanged", () => {
    const err = new Error("boom");
    reportError(err, {
      tags: { health_canary: "true", deployment_skew: true, http_status: 503 },
      level: "warning",
      extra: { attempt: 2 },
      fingerprint: ["health_canary"],
      contexts: { lookup: { slug: "x" } },
    });
    expect(sentry.captureException).toHaveBeenCalledWith(err, {
      tags: { health_canary: "true", deployment_skew: true, http_status: 503 },
      level: "warning",
      extra: { attempt: 2 },
      fingerprint: ["health_canary"],
      contexts: { lookup: { slug: "x" } },
    });
  });

  it("does not add a tags key when neither tags nor area is set", () => {
    reportError(new Error("boom"), { level: "error" });
    expect(sentry.captureException.mock.calls[0]?.[1]).toEqual({ level: "error" });
    expect(sentry.captureException.mock.calls[0]?.[1]).not.toHaveProperty("tags");
  });
});

describe("reportMessage", () => {
  it("passes no capture context when called without options", () => {
    reportMessage("hello");
    expect(sentry.captureMessage).toHaveBeenCalledWith("hello");
    expect(sentry.captureMessage.mock.calls[0]).toHaveLength(1);
  });

  it("maps level and contexts", () => {
    reportMessage("[rate-limiter] x", {
      level: "warning",
      contexts: { "rate-limiter": { key: "v" } },
    });
    expect(sentry.captureMessage).toHaveBeenCalledWith("[rate-limiter] x", {
      level: "warning",
      contexts: { "rate-limiter": { key: "v" } },
    });
  });
});

describe("setReportContext", () => {
  it("forwards the named context", () => {
    setReportContext("brandLookup", { slug: "a" });
    expect(sentry.setContext).toHaveBeenCalledWith("brandLookup", { slug: "a" });
  });
});

describe("isReportingEnabled", () => {
  it("is false without a client", () => {
    sentry.getClient.mockReturnValue(undefined);
    expect(isReportingEnabled()).toBe(false);
  });

  it("is true with a client", () => {
    sentry.getClient.mockReturnValue({});
    expect(isReportingEnabled()).toBe(true);
  });
});
