import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AuditContext } from "@/lib/audit/types";

// Mock the langfuse module before any imports
const mockShutdownAsync = vi.fn().mockResolvedValue(undefined);
const mockFlushAsync = vi.fn().mockResolvedValue(undefined);
const mockLangfuseInstance = {
  shutdownAsync: mockShutdownAsync,
  flushAsync: mockFlushAsync,
};
const MockLangfuse = vi.fn().mockReturnValue(mockLangfuseInstance);

vi.mock("langfuse", () => ({
  Langfuse: MockLangfuse,
}));

describe("langfuse/client", () => {
  const ORIGINAL_ENV = process.env;
  const processOnSpy = vi.spyOn(process, "on");

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    MockLangfuse.mockClear();
    mockShutdownAsync.mockClear();
    mockFlushAsync.mockClear();
    processOnSpy.mockClear();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns a Langfuse instance when all env vars are set", async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    process.env.LANGFUSE_HOST = "https://cloud.langfuse.com";

    const { getLangfuse } = await import("../client");
    const instance = getLangfuse();

    expect(instance).toBe(mockLangfuseInstance);
    expect(MockLangfuse).toHaveBeenCalledOnce();
    expect(MockLangfuse).toHaveBeenCalledWith({
      publicKey: "pk-test",
      secretKey: "sk-test",
      baseUrl: "https://cloud.langfuse.com",
    });
  });

  it("returns null when env vars are missing", async () => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_HOST;

    const { getLangfuse } = await import("../client");
    const instance = getLangfuse();

    expect(instance).toBeNull();
    expect(MockLangfuse).not.toHaveBeenCalled();
  });

  it("registers shutdown hooks for beforeExit and SIGTERM", async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    process.env.LANGFUSE_HOST = "https://cloud.langfuse.com";

    const { getLangfuse } = await import("../client");
    getLangfuse();

    const registeredEvents = processOnSpy.mock.calls.map((call) => call[0]);
    expect(registeredEvents).toContain("beforeExit");
    expect(registeredEvents).toContain("SIGTERM");
  });

  it("flushLangfuse no-ops when instance is null", async () => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_HOST;

    const { getLangfuse, flushLangfuse } = await import("../client");
    getLangfuse(); // ensure null path

    await flushLangfuse();
    expect(mockFlushAsync).not.toHaveBeenCalled();
  });

  it("flushLangfuse calls flushAsync on the instance", async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    process.env.LANGFUSE_HOST = "https://cloud.langfuse.com";

    const { getLangfuse, flushLangfuse } = await import("../client");
    getLangfuse();

    await flushLangfuse();
    expect(mockFlushAsync).toHaveBeenCalledOnce();
  });
});

describe("AuditContext type accepts langfuseTrace", () => {
  it("allows optional langfuseTrace field without breaking existing code", () => {
    // Existing shape still works
    const withoutTrace: AuditContext = { correlationId: "abc" };
    expect(withoutTrace.correlationId).toBe("abc");

    // New optional field accepted
    const withTrace: AuditContext = {
      correlationId: "abc",
      langfuseTrace: { some: "trace-object" },
    };
    expect(withTrace.langfuseTrace).toBeDefined();
  });
});
