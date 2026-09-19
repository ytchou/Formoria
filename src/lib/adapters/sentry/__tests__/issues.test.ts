import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAuditEmitterForTests,
  setAuditWriteSeam,
  type AuditRecord,
} from "@/lib/audit";
import { listIssues } from "../issues";

let writes: AuditRecord[] = [];

beforeEach(() => {
  writes = [];
  setAuditWriteSeam(async (record) => {
    writes.push(record);
    return null;
  });
  vi.stubEnv("SENTRY_BASE_URL", "https://sentry.io");
  vi.stubEnv("SENTRY_ORGANIZATION", "formoria");
  vi.stubEnv("SENTRY_PROJECT", "formoria-web");
  vi.stubEnv("SENTRY_READ_TOKEN", "sntrys_test_token");
});

afterEach(() => {
  resetAuditEmitterForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("listIssues", () => {
  it("preserves the ops-agent default unresolved request", async () => {
    const sentryResponse = [
      {
        id: "42",
        title: "TypeError: Cannot read property 'foo'",
        count: "15",
        userCount: 3,
        lastSeen: "2026-09-15T09:00:00Z",
        permalink: "https://sentry.io/issues/42/",
        level: "error",
        extra_field: "should_be_ignored",
      },
    ];

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(sentryResponse));

    const issues = await listIssues(24);

    expect(issues).toEqual([
      {
        id: "42",
        title: "TypeError: Cannot read property 'foo'",
        count: "15",
        userCount: 3,
        lastSeen: "2026-09-15T09:00:00Z",
        permalink: "https://sentry.io/issues/42/",
        level: "error",
      },
    ]);

    const [url] = fetchMock.mock.calls[0]!;
    const parsedUrl = new URL(url as string);
    expect(parsedUrl.pathname).toBe(
      "/api/0/organizations/formoria/issues/",
    );
    expect(parsedUrl.searchParams.get("query")).toBe(
      "is:unresolved project:formoria-web",
    );
    expect(parsedUrl.searchParams.get("environment")).toBe("production");
    expect(parsedUrl.searchParams.get("statsPeriod")).toBe("24h");
    expect(parsedUrl.searchParams.get("limit")).toBe("20");
  });

  it("builds a complete health snapshot request that excludes canaries", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json([]));

    await listIssues(48, {
      limit: 100,
      excludeHealthCanary: true,
      requireComplete: true,
    });

    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get("query")).toBe(
      "is:unresolved project:formoria-web !health_canary:true",
    );
    expect(url.searchParams.get("environment")).toBe("production");
    expect(url.searchParams.get("statsPeriod")).toBe("48h");
    expect(url.searchParams.get("limit")).toBe("100");
  });

  it("falls back to SENTRY_AUTH_TOKEN when no read token is configured", async () => {
    vi.stubEnv("SENTRY_READ_TOKEN", "");
    vi.stubEnv("SENTRY_AUTH_TOKEN", "sntrys_existing_auth_token");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json([]));

    await listIssues();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sntrys_existing_auth_token",
        }),
      }),
    );
  });

  it("fails on Sentry HTTP errors without exposing the response body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("token=secret-value https://private.example.test", {
        status: 403,
      }),
    );

    await expect(listIssues()).rejects.toThrow(
      "sentry list_issues failed with HTTP 403",
    );
  });

  it("rejects invalid successful payloads", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ id: "not-an-array" }),
    );

    await expect(listIssues()).rejects.toThrow("invalid response");
  });

  it("rejects health snapshots when Sentry reports another page", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json([], {
        headers: {
          Link: '<https://sentry.io/api/0/organizations/formoria/issues/?cursor=next>; rel="next"; results="true"',
        },
      }),
    );

    await expect(
      listIssues(48, { limit: 100, requireComplete: true }),
    ).rejects.toThrow("incomplete snapshot");
  });

  it("rejects an unconfirmed full health snapshot", async () => {
    const page = Array.from({ length: 100 }, (_, index) => ({
      id: String(index),
      title: `Issue ${index}`,
      count: "1",
      userCount: 1,
      lastSeen: "2026-09-19T00:00:00Z",
      permalink: `https://sentry.io/issues/${index}/`,
      level: "error",
    }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(page));

    await expect(
      listIssues(48, { limit: 100, requireComplete: true }),
    ).rejects.toThrow("incomplete snapshot");
  });

  it("accepts a full health snapshot when the next page is confirmed empty", async () => {
    const page = Array.from({ length: 100 }, (_, index) => ({
      id: String(index),
      title: `Issue ${index}`,
      count: "1",
      userCount: 1,
      lastSeen: "2026-09-19T00:00:00Z",
      permalink: `https://sentry.io/issues/${index}/`,
      level: "error",
    }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(page, {
        headers: {
          Link: '<https://sentry.io/api/0/organizations/formoria/issues/?cursor=end>; rel="next"; results="false"',
        },
      }),
    );

    await expect(
      listIssues(48, { limit: 100, requireComplete: true }),
    ).resolves.toHaveLength(100);
  });

  it("list_issues_clamps_window", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(Response.json([])));

    // Below minimum: clamp to 1
    await listIssues(0);
    let url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get("statsPeriod")).toBe("1h");

    fetchMock.mockClear();

    // Above maximum: clamp to 168
    await listIssues(999);
    url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get("statsPeriod")).toBe("168h");

    fetchMock.mockClear();

    // Sanitize long titles
    const longTitle = "A".repeat(300);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json([
        {
          id: "1",
          title: longTitle,
          count: "1",
          userCount: 0,
          lastSeen: "2026-09-15T09:00:00Z",
          permalink: "https://sentry.io/issues/1/",
          level: "warning",
        },
      ]),
    );

    const issues = await listIssues(24);
    expect(issues[0]!.title.length).toBeLessThanOrEqual(200);
  });
});
