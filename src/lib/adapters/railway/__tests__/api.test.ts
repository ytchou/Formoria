import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAuditEmitterForTests,
  setAuditWriteSeam,
  type AuditRecord,
} from "@/lib/audit";
import { redeployE2eAgent } from "../api";

let writes: AuditRecord[] = [];

beforeEach(() => {
  writes = [];
  setAuditWriteSeam(async (record) => {
    writes.push(record);
    return null;
  });
  vi.stubEnv("OPS_AGENT_RAILWAY_TOKEN", "rw_test_token");
});

afterEach(() => {
  resetAuditEmitterForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("redeployE2eAgent", () => {
  it("redeployE2eAgent_calls_railway_graphql_api", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ data: { serviceInstanceRedeploy: true } }),
    );

    const result = await redeployE2eAgent();

    expect(result).toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://backboard.railway.app/graphql");
    expect(init!.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer rw_test_token",
        "Content-Type": "application/json",
      }),
    );
    const body = JSON.parse(init!.body as string);
    expect(body.query).toContain("serviceInstanceRedeploy");
    expect(body.query).toContain("6c4f9c22-8d6c-4d6a-a5c1-5b26428d144f");
    expect(body.query).toContain("cb8f8b37-b99f-4c88-9f83-e5d969d3cfd4");
  });

  it("redeployE2eAgent_throws_when_token_missing", async () => {
    vi.stubEnv("OPS_AGENT_RAILWAY_TOKEN", "");
    // Vitest stubEnv with empty string — clear it properly
    delete process.env.OPS_AGENT_RAILWAY_TOKEN;

    await expect(redeployE2eAgent()).rejects.toThrow(
      "OPS_AGENT_RAILWAY_TOKEN is not set",
    );
  });

  it("redeployE2eAgent_returns_error_on_api_failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error", { status: 500 }),
    );

    const result = await redeployE2eAgent();

    expect(result).toEqual({ ok: false, error: "Railway API error: 500" });
  });

  it("redeployE2eAgent_returns_error_on_graphql_errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        errors: [{ message: "Service not found" }],
      }),
    );

    const result = await redeployE2eAgent();

    expect(result).toEqual({ ok: false, error: "Service not found" });
  });
});
