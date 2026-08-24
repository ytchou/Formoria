import { describe, expect, it, vi } from "vitest";
import maintenanceGate from "./index";

/**
 * DEV-1551. First test for the maintenance Worker.
 *
 * The gate's whole value is that it is closed, so the two properties worth
 * pinning are that a correct token opens it and that nothing else does. The
 * wrong-token case uses a token of EQUAL LENGTH on purpose: after the switch
 * from `===` to a SHA-256 constant-time compare, an equal-length mismatch is
 * the case that proves the comparison still discriminates rather than always
 * returning true.
 */

const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";
const WRONG_TOKEN_SAME_LENGTH = "abcdefghijklmnopqrstuvwxyz012346";

function get(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe("maintenance gate bypass", () => {
  it("gate accepts the correct token", async () => {
    const response = await maintenanceGate.fetch(
      get(`https://formoria.com/brands?gate-bypass=${TOKEN}`),
      { GATE_BYPASS_TOKEN: TOKEN },
    );

    expect(response.status).toBe(302);
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain(`formoria-gate-bypass=${TOKEN}`);
    expect(cookie).toContain("HttpOnly");
    // The token must not survive in the address bar after the first hop.
    expect(response.headers.get("Location")).not.toContain("gate-bypass");
  });

  it("gate rejects a wrong token of equal length", async () => {
    const response = await maintenanceGate.fetch(
      get(`https://formoria.com/brands?gate-bypass=${WRONG_TOKEN_SAME_LENGTH}`),
      { GATE_BYPASS_TOKEN: TOKEN },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("gate fails closed when GATE_BYPASS_TOKEN is unset", async () => {
    const withQuery = await maintenanceGate.fetch(
      get("https://formoria.com/brands?gate-bypass=anything"),
      {},
    );
    expect(withQuery.status).toBe(503);

    // An empty expected token must not compare equal to an empty cookie.
    const withCookie = await maintenanceGate.fetch(
      get("https://formoria.com/brands", {
        Cookie: "formoria-gate-bypass=",
      }),
      {},
    );
    expect(withCookie.status).toBe(503);
  });

  it("serves the real origin for a request carrying the bypass cookie", async () => {
    const originFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("origin", { status: 200 }));

    try {
      const response = await maintenanceGate.fetch(
        get("https://formoria.com/brands", {
          Cookie: `formoria-gate-bypass=${TOKEN}`,
        }),
        { GATE_BYPASS_TOKEN: TOKEN },
      );

      expect(response.status).toBe(200);
      expect(originFetch).toHaveBeenCalledTimes(1);
    } finally {
      originFetch.mockRestore();
    }
  });

  it("answers /api/* with JSON and everything else with the page", async () => {
    const api = await maintenanceGate.fetch(
      get("https://formoria.com/api/brands"),
      { GATE_BYPASS_TOKEN: TOKEN },
    );
    expect(api.status).toBe(503);
    expect(api.headers.get("Content-Type")).toContain("application/json");
    expect((await api.json()).error).toBe("service_unavailable");

    const page = await maintenanceGate.fetch(get("https://formoria.com/"), {
      GATE_BYPASS_TOKEN: TOKEN,
    });
    expect(page.status).toBe(503);
    expect(page.headers.get("Content-Type")).toContain("text/html");
    // A 503 must never be cached past the gate being lifted.
    expect(page.headers.get("CDN-Cache-Control")).toBe("no-store");
  });
});
