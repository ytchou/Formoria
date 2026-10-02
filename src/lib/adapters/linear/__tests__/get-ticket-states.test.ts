import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAuditEmitterForTests,
  setAuditWriteSeam,
  type AuditRecord,
} from "@/lib/audit";
import { getTicketStates } from "../get-ticket-states";

let writes: AuditRecord[] = [];

beforeEach(() => {
  writes = [];
  setAuditWriteSeam(async (record) => {
    writes.push(record);
    return null;
  });
  vi.stubEnv("LINEAR_API_KEY", "lin_api_test_key");
});

afterEach(() => {
  resetAuditEmitterForTests();
  vi.unstubAllEnvs();
});

function fetchReturning(response: Response) {
  return vi.fn<typeof fetch>().mockResolvedValue(response);
}

describe("getTicketStates", () => {
  it("returns state name and closed flag per identifier from one aliased request", async () => {
    const fetchFn = fetchReturning(
      Response.json({
        data: {
          t0: { identifier: "DEV-1909", state: { name: "Duplicate", type: "duplicate" } },
          t1: { identifier: "DEV-1903", state: { name: "In Progress", type: "started" } },
        },
      }),
    );

    const result = await getTicketStates(["DEV-1909", "DEV-1903"], fetchFn);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api.linear.app/graphql");
    expect(init!.headers).toEqual(
      expect.objectContaining({ Authorization: "lin_api_test_key" }),
    );
    const body = JSON.parse(init!.body as string);
    expect(body.query.match(/issue\(id:/g)).toHaveLength(2);
    expect(body.query).not.toContain("DEV-1909");
    expect(body.variables).toEqual({ id0: "DEV-1909", id1: "DEV-1903" });

    expect(result).toBeInstanceOf(Map);
    expect(result.get("DEV-1909")).toEqual({ state: "Duplicate", closed: true });
    expect(result.get("DEV-1903")).toEqual({ state: "In Progress", closed: false });
  });

  it("marks only completed, canceled and duplicate state types as closed", async () => {
    const fetchFn = fetchReturning(
      Response.json({
        data: {
          t0: { identifier: "DEV-1", state: { name: "Done", type: "completed" } },
          t1: { identifier: "DEV-2", state: { name: "Canceled", type: "canceled" } },
          t2: { identifier: "DEV-3", state: { name: "Todo", type: "unstarted" } },
          t3: { identifier: "DEV-4", state: { name: "Backlog", type: "backlog" } },
          t4: { identifier: "DEV-5", state: { name: "Duplicate", type: "duplicate" } },
        },
      }),
    );

    const result = await getTicketStates(["DEV-1", "DEV-2", "DEV-3", "DEV-4", "DEV-5"], fetchFn);

    expect([...result.values()].map((value) => value.closed)).toEqual([
      true,
      true,
      false,
      false,
      true,
    ]);
  });

  it("keys each state by the requested identifier, not the one Linear returns", async () => {
    // DEV-100 moved teams and is now OPS-12; Linear resolves the old identifier.
    const fetchFn = fetchReturning(
      Response.json({
        data: {
          t0: { identifier: "OPS-12", state: { name: "Done", type: "completed" } },
        },
      }),
    );

    const result = await getTicketStates(["DEV-100"], fetchFn);

    expect(result.get("DEV-100")).toEqual({ state: "Done", closed: true });
    expect(result.has("OPS-12")).toBe(false);
  });

  it("keeps resolved identifiers when another one is not found (partial data)", async () => {
    const fetchFn = fetchReturning(
      Response.json({
        data: {
          t0: { identifier: "DEV-1909", state: { name: "Done", type: "completed" } },
          t1: null,
        },
        errors: [{ message: "Entity not found", path: ["t1"] }],
      }),
    );

    const result = await getTicketStates(["DEV-1909", "DEV-0000"], fetchFn);

    expect(result.size).toBe(1);
    expect(result.get("DEV-1909")).toEqual({ state: "Done", closed: true });
    expect(result.has("DEV-0000")).toBe(false);
  });

  it("omits identifiers Linear returns null for", async () => {
    const fetchFn = fetchReturning(
      Response.json({
        data: {
          t0: { identifier: "DEV-1909", state: { name: "Done", type: "completed" } },
          t1: null,
        },
      }),
    );

    const result = await getTicketStates(["DEV-1909", "DEV-0000"], fetchFn);

    expect(result.size).toBe(1);
    expect(result.has("DEV-0000")).toBe(false);
  });

  it("throws on HTTP non-2xx and on errors with no data", async () => {
    await expect(
      getTicketStates(["DEV-1"], fetchReturning(new Response("nope", { status: 500 }))),
    ).rejects.toThrow(/500/);

    await expect(
      getTicketStates(
        ["DEV-1"],
        fetchReturning(
          Response.json({ data: null, errors: [{ message: "Authentication required" }] }),
        ),
      ),
    ).rejects.toThrow(/Authentication required/);

    await expect(
      getTicketStates(
        ["DEV-1"],
        fetchReturning(Response.json({ errors: [{ message: "Syntax error" }] })),
      ),
    ).rejects.toThrow(/Syntax error/);
  });

  it("returns an empty map without calling fetch for an empty list", async () => {
    const fetchFn = vi.fn<typeof fetch>();

    const result = await getTicketStates([], fetchFn);

    expect(result.size).toBe(0);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("throws when LINEAR_API_KEY is unset", async () => {
    vi.stubEnv("LINEAR_API_KEY", "");
    const fetchFn = vi.fn<typeof fetch>();

    await expect(getTicketStates(["DEV-1"], fetchFn)).rejects.toThrow(/LINEAR_API_KEY/);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

