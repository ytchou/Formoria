import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAuditEmitterForTests,
  setAuditWriteSeam,
  type AuditRecord,
} from "@/lib/audit";
import { getTicketStates, isClosedState } from "../get-ticket-states";

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
  it("returns state name and type per identifier from one aliased request", async () => {
    const fetchFn = fetchReturning(
      Response.json({
        data: {
          t0: { identifier: "DEV-1909", state: { name: "Duplicate", type: "canceled" } },
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
    expect(result.get("DEV-1909")).toEqual({ state: "Duplicate", type: "canceled" });
    expect(result.get("DEV-1903")).toEqual({ state: "In Progress", type: "started" });
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

  it("throws on HTTP non-2xx and on body.errors", async () => {
    await expect(
      getTicketStates(["DEV-1"], fetchReturning(new Response("nope", { status: 500 }))),
    ).rejects.toThrow(/500/);

    await expect(
      getTicketStates(
        ["DEV-1"],
        fetchReturning(Response.json({ errors: [{ message: "Entity not found" }] })),
      ),
    ).rejects.toThrow(/Entity not found/);
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

describe("isClosedState", () => {
  it("is true only for completed and canceled", () => {
    expect(isClosedState("completed")).toBe(true);
    expect(isClosedState("canceled")).toBe(true);
    expect(isClosedState("started")).toBe(false);
    expect(isClosedState("backlog")).toBe(false);
  });
});
