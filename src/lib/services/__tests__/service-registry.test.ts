import { describe, expect, it } from "vitest";
import {
  SERVICE_REGISTRY,
  toInventoryProjection,
} from "@/lib/services/service-registry";

describe("service registry", () => {
  it("every entry has a unique id", () => {
    const ids = SERVICE_REGISTRY.map((entry) => entry.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every id is kebab-case", () => {
    expect(
      SERVICE_REGISTRY.every((entry) =>
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id),
      ),
    ).toBe(true);
  });

  it("every entry declares an operational section and kind", () => {
    expect(
      SERVICE_REGISTRY.every(
        (entry) =>
          ["production", "back-office", "agents", "deprecated", null].includes(
            entry.operationalSection,
          ) &&
          ["dependency", "worker", "alert"].includes(entry.operationalKind),
      ),
    ).toBe(true);
  });

  it("probed entries declare env vars", () => {
    expect(
      SERVICE_REGISTRY.filter((entry) => entry.probe === "executive-health")
        .filter((entry) => entry.name !== "Public site")
        .every((entry) => entry.envVars.length > 0),
    ).toBe(true);
  });

  it("keeps variable usage limits separate from fixed subscriptions", () => {
    const supabase = SERVICE_REGISTRY.find((entry) => entry.id === "supabase");
    const openai = SERVICE_REGISTRY.find((entry) => entry.id === "openai");
    const railway = SERVICE_REGISTRY.find(
      (entry) => entry.id === "railway-formoria",
    );

    expect(supabase?.quota).toBeUndefined();
    expect(openai?.plan.monthlyUsd).toBeUndefined();
    expect(openai?.quota).toMatchObject({ included: 25, unit: "USD / month" });
    expect(railway?.plan.monthlyUsd).toBe(5);
  });

  it("dead keys are marked unwired", () => {
    expect(
      SERVICE_REGISTRY.find((entry) => entry.envVars.includes("INDEXNOW_KEY"))
        ?.status,
    ).toBe("unwired");
    expect(
      SERVICE_REGISTRY.find((entry) =>
        entry.envVars.includes("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"),
      )?.status,
    ).toBe("unwired");
  });

  it("toInventoryProjection omits internal fields", () => {
    const entry = SERVICE_REGISTRY[0];
    const projection = toInventoryProjection(entry);

    expect(projection).toEqual(
      expect.objectContaining({
        id: entry.id,
        name: entry.name,
        vendor: entry.vendor,
        category: entry.category,
        criticality: entry.criticality,
        status: entry.status,
        plan: {
          kind: entry.plan.kind,
          monthlyUsd: entry.plan.monthlyUsd ?? null,
          asOf: entry.plan.asOf,
        },
        dashboardUrl: entry.dashboardUrl ?? null,
      }),
    );
    expect(projection).not.toHaveProperty("envVars");
    expect(projection).not.toHaveProperty("probe");
    expect(projection).not.toHaveProperty("meter");
  });

  it("projects the four visible sections and excludes governed hidden entries", () => {
    const inventory = SERVICE_REGISTRY.map(toInventoryProjection).filter(
      (entry): entry is NonNullable<typeof entry> => entry !== null,
    );

    expect(inventory.map((entry) => entry.operationalSection)).toEqual([
      "production",
      "production",
      "back-office",
      "deprecated",
      "back-office",
      "production",
      "production",
      "production",
      "production",
      "back-office",
      "back-office",
      "back-office",
      "back-office",
      "agents",
      "agents",
      "production",
      "agents",
      "deprecated",
    ]);
    expect(inventory).toHaveLength(18);
    expect(
      inventory.some((entry) =>
        [
          "linear",
          "github",
          "google-maps",
          "agent-hub",
          "anthropic",
          "indexnow",
        ].includes(entry.id),
      ),
    ).toBe(false);
  });
});
