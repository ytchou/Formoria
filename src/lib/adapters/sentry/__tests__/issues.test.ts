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
  it("list_issues_queries_unresolved_for_window", async () => {
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
