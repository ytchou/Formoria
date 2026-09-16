import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EGRESS_DAILY_LIMIT_BYTES,
  MONITORED_EGRESS_PATH_PREFIXES,
  buildEgressAnomalyNotification,
  checkEgressAnomaly,
  parseEgressBytesByDay,
} from "../egress-monitoring";

const GB = 1024 ** 3;
const NOW = new Date("2026-09-16T03:00:00.000Z");

/**
 * Shape of the Cloudflare GraphQL Analytics response this service reads: one
 * aliased `httpRequestsAdaptiveGroups` block per monitored path prefix, each
 * grouped by date.
 */
function analyticsResponse(
  perAlias: Record<string, Array<{ date: string; bytes: number }>>,
): Response {
  const zone: Record<string, unknown> = {};
  for (const [alias, days] of Object.entries(perAlias)) {
    zone[alias] = days.map((day) => ({
      dimensions: { date: day.date },
      sum: { edgeResponseBytes: day.bytes },
    }));
  }
  return Response.json({ data: { viewer: { zones: [zone] } } });
}

function monitoring(fetchImpl: typeof fetch) {
  return checkEgressAnomaly({
    apiToken: "cf-test-token",
    zoneId: "zone-test",
    fetchImpl,
    now: NOW,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("egress-monitoring", () => {
  it("flags a day exceeding the 5 GB cap", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      analyticsResponse({
        proxiedImages: [
          { date: "2026-09-14", bytes: 0.2 * GB },
          { date: "2026-09-15", bytes: 5.5 * GB },
        ],
        nextImages: [
          { date: "2026-09-14", bytes: 0.05 * GB },
          { date: "2026-09-15", bytes: 1 * GB },
        ],
      }),
    ) as unknown as typeof fetch;

    const report = await monitoring(fetchImpl);

    expect(report.state).toBe("ready");
    expect(report.exceeded).toBe(true);
    expect(report.risk).toBe("critical");
    expect(report.worstDay).toEqual({ date: "2026-09-15", bytes: 6.5 * GB });
    expect(report.limitBytes).toBe(EGRESS_DAILY_LIMIT_BYTES);
    expect(EGRESS_DAILY_LIMIT_BYTES).toBe(5 * GB);

    const notification = buildEgressAnomalyNotification(report);
    expect(notification.status).toBe("needs_attention");
    expect(notification.summary.join(" ")).toContain("2026-09-15");
  });

  it("does not flag a day within baseline", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      analyticsResponse({
        proxiedImages: [
          { date: "2026-09-14", bytes: 0.3 * GB },
          { date: "2026-09-15", bytes: 0.28 * GB },
        ],
        nextImages: [],
      }),
    ) as unknown as typeof fetch;

    const report = await monitoring(fetchImpl);

    expect(report.state).toBe("ready");
    expect(report.exceeded).toBe(false);
    expect(report.risk).toBe("normal");
    expect(report.worstDay).toEqual({ date: "2026-09-14", bytes: 0.3 * GB });
    expect(buildEgressAnomalyNotification(report).status).toBe("success");
  });

  it("surfaces a Cloudflare API error without throwing", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        Response.json({ errors: [{ message: "nope" }] }, { status: 403 }),
      ) as unknown as typeof fetch;

    const report = await monitoring(fetchImpl);

    expect(report.state).toBe("error");
    expect(report.exceeded).toBe(false);
    expect(report.risk).toBe("unknown");
    expect(report.message).toContain("403");
    // A monitoring path that pages on its own failure is alert fatigue; a
    // degraded read is reported, not escalated as an egress incident.
    expect(buildEgressAnomalyNotification(report).status).toBe(
      "needs_attention",
    );
  });

  it("reports GraphQL-level errors returned with HTTP 200", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        Response.json({ data: null, errors: [{ message: "bad zone tag" }] }),
      ) as unknown as typeof fetch;

    const report = await monitoring(fetchImpl);

    expect(report.state).toBe("error");
    expect(report.message).toContain("bad zone tag");
  });

  it("is unconfigured, not failing, without Cloudflare credentials", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const report = await checkEgressAnomaly({
      apiToken: "",
      zoneId: "",
      fetchImpl,
      now: NOW,
    });

    expect(report.state).toBe("unconfigured");
    expect(report.exceeded).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sums the monitored path prefixes per day", () => {
    const days = parseEgressBytesByDay({
      data: {
        viewer: {
          zones: [
            {
              proxiedImages: [
                { dimensions: { date: "2026-09-15" }, sum: { edgeResponseBytes: 100 } },
              ],
              nextImages: [
                { dimensions: { date: "2026-09-15" }, sum: { edgeResponseBytes: 25 } },
                { dimensions: { date: "2026-09-14" }, sum: { edgeResponseBytes: 7 } },
              ],
            },
          ],
        },
      },
    });

    expect(days).toEqual([
      { date: "2026-09-14", bytes: 7 },
      { date: "2026-09-15", bytes: 125 },
    ]);
    expect(MONITORED_EGRESS_PATH_PREFIXES).toEqual(["/i/", "/_next/image"]);
  });

  it("does not depend on Railway telemetry", async () => {
    // PR #891 removed the Railway usage meter deliberately: Cloudflare is the
    // single source for edge bytes. This asserts the module never reads a
    // Railway credential back in.
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(
        new URL("../egress-monitoring.ts", import.meta.url),
        "utf8",
      ),
    );

    expect(source).not.toContain("RAILWAY");
  });
});
