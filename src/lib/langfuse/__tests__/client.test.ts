import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AuditContext } from "@/lib/audit/types";

describe("langfuse/client", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns null when env vars are missing", async () => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_HOST;

    const { getLangfuse } = await import("../client");
    expect(getLangfuse()).toBeNull();
  });

  it("returns a non-null instance when all env vars are set", async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    process.env.LANGFUSE_HOST = "https://cloud.langfuse.com";

    const { getLangfuse } = await import("../client");
    const instance = getLangfuse();

    expect(instance).not.toBeNull();
    expect(instance).toHaveProperty("shutdownAsync");
    expect(instance).toHaveProperty("flushAsync");
  });

  it("caches the instance across calls", async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    process.env.LANGFUSE_HOST = "https://cloud.langfuse.com";

    const { getLangfuse } = await import("../client");
    const a = getLangfuse();
    const b = getLangfuse();
    expect(a).toBe(b);
  });

  it("registers shutdown hooks for beforeExit and SIGTERM", async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    process.env.LANGFUSE_HOST = "https://cloud.langfuse.com";

    const processOnSpy = vi.spyOn(process, "on");

    const { getLangfuse } = await import("../client");
    getLangfuse();

    const registeredEvents = processOnSpy.mock.calls.map((call) => call[0]);
    expect(registeredEvents).toContain("beforeExit");
    expect(registeredEvents).toContain("SIGTERM");
    processOnSpy.mockRestore();
  });

  it("flushLangfuse no-ops when instance is null", async () => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_HOST;

    const { getLangfuse, flushLangfuse } = await import("../client");
    getLangfuse();
    await expect(flushLangfuse()).resolves.toBeUndefined();
  });

  it("flushLangfuse resolves when instance exists", async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    process.env.LANGFUSE_HOST = "https://cloud.langfuse.com";

    const { getLangfuse, flushLangfuse } = await import("../client");
    getLangfuse();
    await expect(flushLangfuse()).resolves.toBeUndefined();
  });
});

describe("AuditContext type accepts langfuseTrace", () => {
  it("allows optional langfuseTrace field without breaking existing code", () => {
    const withoutTrace: AuditContext = { correlationId: "abc" };
    expect(withoutTrace.correlationId).toBe("abc");

    const withTrace: AuditContext = {
      correlationId: "abc",
      langfuseTrace: { some: "trace-object" },
    };
    expect(withTrace.langfuseTrace).toBeDefined();
  });
});
