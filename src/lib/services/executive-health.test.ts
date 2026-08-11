import { describe, expect, it, vi } from "vitest";
import {
  classifyExecutiveHealth,
  createExecutiveHealthMonitor,
  defaultChecks,
  loadExecutiveHealth,
  runExecutiveHealthCheck,
  type ExecutiveServiceHealth,
} from "./executive-health";
import {
  checkMitRegistryHealth,
  classifyMitRegistryHealth,
  MIT_REGISTRY_SYNC_MAX_AGE_HOURS,
} from "./mit-registry";
import { SERVICE_REGISTRY } from "./service-registry";

function service(
  id: string,
  name: string,
  tier: ExecutiveServiceHealth["tier"],
  status: ExecutiveServiceHealth["status"],
): ExecutiveServiceHealth {
  return {
    id,
    service: name,
    tier,
    status,
    message: "Checked",
    checkedAt: "2026-07-19T00:00:00Z",
  };
}

describe("executive health", () => {
  it("caches results for five minutes and supports explicit refresh", async () => {
    let now = 1_000;
    const load = vi.fn().mockResolvedValue({
      status: "healthy",
      checkedAt: "2026-07-19T00:00:00Z",
      services: [
        service("public-site", "Public site", "customer-critical", "healthy"),
      ],
      inventory: [],
    });
    const monitor = createExecutiveHealthMonitor({ load, now: () => now });

    await monitor.get();
    now += 299_000;
    await monitor.get();
    await monitor.refresh();

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("classifies customer-critical outages above support degradation", () => {
    expect(
      classifyExecutiveHealth([
        service("public-site", "Public site", "customer-critical", "down"),
        service("resend", "Resend", "customer-flow", "degraded"),
      ]),
    ).toBe("critical");
    expect(
      classifyExecutiveHealth([
        service("resend", "Resend", "customer-flow", "down"),
      ]),
    ).toBe("warning");
    expect(
      classifyExecutiveHealth([
        service("public-site", "Public site", "customer-critical", "healthy"),
      ]),
    ).toBe("healthy");
  });

  it("keeps back-office failures out of the overall status", () => {
    expect(
      classifyExecutiveHealth([
        service("sentry", "Sentry", "back-office", "down"),
        service("posthog", "PostHog", "back-office", "unconfigured"),
      ]),
    ).toBe("healthy");
    expect(
      classifyExecutiveHealth([
        service("resend", "Resend", "customer-flow", "degraded"),
        service("sentry", "Sentry", "back-office", "down"),
      ]),
    ).toBe("warning");
  });

  it("sanitizes thrown provider errors and audits request, response, latency, and status", async () => {
    const audit = vi.fn();
    const result = await runExecutiveHealthCheck(
      {
        id: "provider",
        service: "Provider",
        tier: "back-office",
        request: { endpoint: "https://provider.example/health" },
        run: async () => {
          throw new Error("Bearer secret-value");
        },
      },
      audit,
    );

    expect(result.message).toBe("Provider request failed");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        request: { endpoint: "https://provider.example/health" },
        response: expect.objectContaining({ status: "down" }),
        latencyMs: expect.any(Number),
        status: "error",
      }),
    );
    expect(JSON.stringify(audit.mock.calls)).not.toContain("secret-value");
  });

  it("keeps every executive check aligned with the registry id and tier", () => {
    const checks = defaultChecks();
    const probedEntries = SERVICE_REGISTRY.filter(
      (entry) => entry.probe === "executive-health",
    );

    expect(checks).toHaveLength(11);
    expect(new Set(checks.map((check) => check.id))).toEqual(
      new Set(probedEntries.map((entry) => entry.id)),
    );
    expect(
      checks.every(
        (check) =>
          SERVICE_REGISTRY.find((entry) => entry.id === check.id)
            ?.criticality === check.tier,
      ),
    ).toBe(true);
    expect(
      SERVICE_REGISTRY.find((entry) => entry.id === "sentry")?.criticality,
    ).toBe("back-office");
  });

  it("classifies MIT mirror freshness from the local sync timestamp", () => {
    const now = new Date("2026-08-11T00:00:00.000Z");
    const fresh = new Date(
      now.getTime() - (MIT_REGISTRY_SYNC_MAX_AGE_HOURS - 1) * 60 * 60 * 1000,
    ).toISOString();
    const stale = new Date(
      now.getTime() - (MIT_REGISTRY_SYNC_MAX_AGE_HOURS + 1) * 60 * 60 * 1000,
    ).toISOString();

    expect(
      classifyMitRegistryHealth(
        [{ cert_number: "MIT-001", synced_at: fresh }],
        now,
      ),
    ).toMatchObject({ status: "healthy" });
    expect(
      classifyMitRegistryHealth(
        [{ cert_number: "MIT-001", synced_at: stale }],
        now,
      ),
    ).toMatchObject({ status: "degraded" });
    expect(
      classifyMitRegistryHealth(
        [{ cert_number: "MIT-001", synced_at: "not-a-timestamp" }],
        now,
      ),
    ).toMatchObject({ status: "degraded" });
    expect(classifyMitRegistryHealth([], now)).toMatchObject({
      status: "down",
    });
  });

  it("marks a failed MIT mirror query down", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not-a-url");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");

    await expect(checkMitRegistryHealth()).resolves.toEqual({
      status: "down",
      message: "MIT registry query failed",
    });
    vi.unstubAllEnvs();
  });

  it("uses the authenticated organization probe for Sentry, not its DSN", async () => {
    vi.stubEnv("SENTRY_DSN", "https://public@example.ingest.sentry.io/1");
    vi.stubEnv(
      "NEXT_PUBLIC_SENTRY_DSN",
      "https://public@example.ingest.sentry.io/1",
    );
    vi.stubEnv("SENTRY_BASE_URL", "");
    vi.stubEnv("SENTRY_ORGANIZATION", "");
    vi.stubEnv("SENTRY_READ_TOKEN", "");
    vi.stubEnv("SENTRY_AUTH_TOKEN", "");

    const check = defaultChecks().find((entry) => entry.id === "sentry");
    expect(check?.request).toMatchObject({ configured: false });
    await expect(check?.run()).resolves.toMatchObject({
      status: "unconfigured",
      message: "Sentry health-read probe is not configured",
    });
    vi.unstubAllEnvs();
  });

  it("describes PostHog as a query probe when its credentials are absent", async () => {
    vi.stubEnv("POSTHOG_API_HOST", "");
    vi.stubEnv("POSTHOG_PROJECT_ID", "");
    vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "");

    const check = defaultChecks().find((entry) => entry.id === "posthog");
    await expect(check?.run()).resolves.toMatchObject({
      status: "unconfigured",
      message: "PostHog query probe is not configured",
    });
    vi.unstubAllEnvs();
  });

  describe("Turnstile executive probe", () => {
    it("accepts only Cloudflare's missing-response result as a healthy probe", async () => {
      vi.stubEnv("TURNSTILE_SECRET_KEY", "accepted-secret");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              success: false,
              "error-codes": ["missing-input-response"],
            }),
            { status: 200 },
          ),
        ),
      );

      const check = defaultChecks().find(
        (entry) => entry.id === "cloudflare-turnstile",
      );
      await expect(runExecutiveHealthCheck(check!)).resolves.toMatchObject({
        status: "healthy",
      });
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it.each([
      [
        "invalid secret",
        { success: false, "error-codes": ["invalid-input-secret"] },
      ],
      ["malformed JSON", null],
    ])("rejects a %s response as down", async (_label, payload) => {
      vi.stubEnv("TURNSTILE_SECRET_KEY", "accepted-secret");
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            payload === null
              ? new Response("not-json", { status: 200 })
              : new Response(JSON.stringify(payload), { status: 200 }),
          ),
      );

      const check = defaultChecks().find(
        (entry) => entry.id === "cloudflare-turnstile",
      );
      await expect(runExecutiveHealthCheck(check!)).resolves.toMatchObject({
        status: "down",
      });
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it("treats a missing secret as down instead of green", async () => {
      vi.stubEnv("TURNSTILE_SECRET_KEY", "");

      const check = defaultChecks().find(
        (entry) => entry.id === "cloudflare-turnstile",
      );
      await expect(runExecutiveHealthCheck(check!)).resolves.toMatchObject({
        status: "down",
      });
      vi.unstubAllEnvs();
    });
  });

  it("snapshot carries an inventory array", async () => {
    const snapshot = await loadExecutiveHealth();

    expect(snapshot.inventory).toHaveLength(
      SERVICE_REGISTRY.filter((entry) => entry.operationalSection !== null)
        .length,
    );
    expect(snapshot.inventory.map((entry) => entry.operationalSection)).toEqual(
      expect.arrayContaining(["production", "back-office", "agents", "deprecated"]),
    );
  });

  it("unprobed services do not appear in services[]", async () => {
    const snapshot = await loadExecutiveHealth();
    const probedIds = new Set(defaultChecks().map((check) => check.id));

    expect(snapshot.services).toHaveLength(11);
    expect(snapshot.inventory.length).toBeGreaterThan(snapshot.services.length);
    expect(snapshot.inventory.some((entry) => ["linear", "github", "google-maps", "agent-hub", "anthropic", "indexnow"].includes(entry.id))).toBe(false);
    expect(
      snapshot.services.every((service) => probedIds.has(service.id)),
    ).toBe(true);
  });

  it("classifyExecutiveHealth ignores inventory", () => {
    expect(
      classifyExecutiveHealth([
        service("public-site", "Public site", "customer-critical", "healthy"),
        service("supabase", "Supabase", "customer-critical", "healthy"),
      ]),
    ).toBe("healthy");
  });
});
