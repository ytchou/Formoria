import { describe, expect, it, vi } from "vitest";
import {
  classifyExecutiveHealth,
  createExecutiveHealthMonitor,
  defaultChecks,
  loadExecutiveHealth,
  runExecutiveHealthCheck,
  type ExecutiveServiceHealth,
} from "./executive-health";
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

  it("every default check declares a registry id", () => {
    const registryIds = new Set(SERVICE_REGISTRY.map((entry) => entry.id));

    expect(defaultChecks()).toHaveLength(12);
    expect(defaultChecks().every((check) => registryIds.has(check.id))).toBe(
      true,
    );
  });

  it("snapshot carries an inventory array", async () => {
    const snapshot = await loadExecutiveHealth();

    expect(snapshot.inventory).toHaveLength(SERVICE_REGISTRY.length);
  });

  it("unprobed services do not appear in services[]", async () => {
    const snapshot = await loadExecutiveHealth();
    const probedIds = new Set(defaultChecks().map((check) => check.id));

    expect(snapshot.services).toHaveLength(12);
    expect(snapshot.inventory.length).toBeGreaterThan(snapshot.services.length);
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
