import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/audit", () => ({
  auditedCall: vi
    .fn()
    .mockImplementation(
      (_spec: unknown, fn: (ctx: { summary: Record<string, unknown> }) => unknown) =>
        fn({ summary: {} }),
    ),
}));

import {
  createRequest,
  admitRequest,
  getRequest,
  isActiveThread,
  transitionRequest,
} from "../requests";

function makeDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    slack_event_id: "evt-1",
    slack_user_id: "U1",
    operator_email: "a@x.com",
    channel_id: "C_OPS",
    thread_ts: "1234.5678",
    card_ts: null,
    text: "show me brands",
    status: "received",
    result: null,
    proposal: null,
    tool_calls: [],
    model_calls: 0,
    cost_usd: 0,
    correlation_id: null,
    expires_at: null,
    created_at: "2026-09-15T00:00:00Z",
    updated_at: "2026-09-15T00:00:00Z",
    ...overrides,
  };
}

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockClient = { from: mockFrom, rpc: mockRpc } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

function chainableQuery(data: unknown, error: unknown = null) {
  const obj: Record<string, unknown> = {};
  const self = obj;
  obj.insert = vi.fn().mockReturnValue(self);
  obj.select = vi.fn().mockReturnValue(self);
  obj.update = vi.fn().mockReturnValue(self);
  obj.eq = vi.fn().mockReturnValue(self);
  obj.in = vi.fn().mockReturnValue(self);
  obj.gte = vi.fn().mockReturnValue(self);
  obj.lt = vi.fn().mockReturnValue(self);
  obj.lte = vi.fn().mockReturnValue(self);
  obj.single = vi.fn().mockResolvedValue({ data, error });
  obj.maybeSingle = vi.fn().mockResolvedValue({ data, error });
  return obj;
}

describe("createRequest", () => {
  it("deduplicates on slack_event_id (23505)", async () => {
    const chain = chainableQuery(null, { code: "23505", message: "unique violation" });
    mockFrom.mockReturnValue(chain);

    const result = await createRequest(
      {
        slackEventId: "evt-dup",
        slackUserId: "U1",
        operatorEmail: "a@x.com",
        channelId: "C_OPS",
        threadTs: "1234.5678",
        text: "hello",
        status: "received",
      },
      mockClient,
    );

    expect(result).toEqual({ duplicate: true });
  });

  it("returns the row on successful insert", async () => {
    const row = makeDbRow();
    const chain = chainableQuery(row);
    mockFrom.mockReturnValue(chain);

    const result = await createRequest(
      {
        slackEventId: "evt-1",
        slackUserId: "U1",
        operatorEmail: "a@x.com",
        channelId: "C_OPS",
        threadTs: "1234.5678",
        text: "show me brands",
        status: "received",
      },
      mockClient,
    );

    expect(result.duplicate).toBe(false);
    if (!result.duplicate) {
      expect(result.row.id).toBe("req-1");
      expect(result.row.slackEventId).toBe("evt-1");
    }
  });

  it("accepts refused status with null operatorEmail", async () => {
    const row = makeDbRow({ operator_email: null, status: "refused" });
    const chain = chainableQuery(row);
    mockFrom.mockReturnValue(chain);

    const result = await createRequest(
      {
        slackEventId: "evt-refused",
        slackUserId: "U_UNKNOWN",
        operatorEmail: null,
        channelId: "C_OPS",
        threadTs: "1234.5678",
        text: "hello",
        status: "refused",
      },
      mockClient,
    );

    expect(result.duplicate).toBe(false);
    if (!result.duplicate) {
      expect(result.row.operatorEmail).toBeNull();
      expect(result.row.status).toBe("refused");
    }
  });
});

describe("admitRequest", () => {
  it("refuses when daily count exceeds cap (count includes self)", async () => {
    const insertChain = chainableQuery(makeDbRow());

    const countChain: Record<string, unknown> = {};
    const countInner: Record<string, unknown> = {};
    countInner.lt = vi.fn().mockResolvedValue({ count: 51, error: null });
    countInner.gte = vi.fn().mockReturnValue(countInner);
    const countNeqLayer: Record<string, unknown> = {};
    countNeqLayer.neq = vi.fn().mockReturnValue(countInner);
    countChain.eq = vi.fn().mockReturnValue(countNeqLayer);
    const countOuter: Record<string, unknown> = {};
    countOuter.select = vi.fn().mockReturnValue(countChain);

    const updateChain = chainableQuery(makeDbRow({ status: "refused" }));

    mockFrom
      .mockReturnValueOnce(insertChain)
      .mockReturnValueOnce(countOuter)
      .mockReturnValueOnce(updateChain);

    const result = await admitRequest(
      {
        slackEventId: "evt-cap",
        slackUserId: "U1",
        operatorEmail: "a@x.com",
        channelId: "C_OPS",
        threadTs: "1234.5678",
        text: "hello",
        status: "received",
      },
      50,
      mockClient,
    );

    expect(result).toEqual({ ok: false, reason: "daily_cap" });
  });

  it("admits when daily count is at or below cap", async () => {
    const row = makeDbRow();
    const insertChain = chainableQuery(row);

    const countChain: Record<string, unknown> = {};
    const countInner: Record<string, unknown> = {};
    countInner.lt = vi.fn().mockResolvedValue({ count: 50, error: null });
    countInner.gte = vi.fn().mockReturnValue(countInner);
    const countNeqLayer2: Record<string, unknown> = {};
    countNeqLayer2.neq = vi.fn().mockReturnValue(countInner);
    countChain.eq = vi.fn().mockReturnValue(countNeqLayer2);
    const countOuter: Record<string, unknown> = {};
    countOuter.select = vi.fn().mockReturnValue(countChain);

    mockFrom
      .mockReturnValueOnce(insertChain)
      .mockReturnValueOnce(countOuter);

    const result = await admitRequest(
      {
        slackEventId: "evt-ok",
        slackUserId: "U1",
        operatorEmail: "a@x.com",
        channelId: "C_OPS",
        threadTs: "1234.5678",
        text: "hello",
        status: "received",
      },
      50,
      mockClient,
    );

    expect(result).toEqual({ ok: true, row: expect.objectContaining({ id: "req-1" }) });
  });
});

describe("transitionRequest", () => {
  it("throws on illegal transition (answered -> awaiting_confirm)", async () => {
    const chain = chainableQuery(null, {
      code: "PGRST116",
      message: "no rows returned",
    });
    mockFrom.mockReturnValue(chain);

    await expect(
      transitionRequest("req-1", ["answered"], "awaiting_confirm", undefined, mockClient),
    ).rejects.toThrow();
  });

  it("succeeds on legal transition (awaiting_confirm -> executed)", async () => {
    const row = makeDbRow({ status: "executed" });
    const chain = chainableQuery(row);
    mockFrom.mockReturnValue(chain);

    const result = await transitionRequest(
      "req-1",
      ["awaiting_confirm"],
      "executed",
      undefined,
      mockClient,
    );
    expect(result.status).toBe("executed");
  });
});

describe("isActiveThread", () => {
  function makeCountChain(count: number | null, error: unknown = null) {
    const terminal: Record<string, unknown> = {};
    terminal.neq = vi.fn().mockResolvedValue({ count, error });
    const eqLayer: Record<string, unknown> = {};
    eqLayer.eq = vi.fn().mockReturnValue(terminal);
    const selectLayer: Record<string, unknown> = {};
    selectLayer.eq = vi.fn().mockReturnValue(eqLayer);
    const outer: Record<string, unknown> = {};
    outer.select = vi.fn().mockReturnValue(selectLayer);
    return outer;
  }

  it("returns true when matching non-refused row exists", async () => {
    mockFrom.mockReturnValue(makeCountChain(2));
    const result = await isActiveThread("C_OPS", "1234.5678", mockClient);
    expect(result).toBe(true);
  });

  it("returns false when no rows match", async () => {
    mockFrom.mockReturnValue(makeCountChain(0));
    const result = await isActiveThread("C_OPS", "1234.5678", mockClient);
    expect(result).toBe(false);
  });

  it("returns false when only refused rows exist", async () => {
    mockFrom.mockReturnValue(makeCountChain(0));
    const result = await isActiveThread("C_OPS", "1234.5678", mockClient);
    expect(result).toBe(false);
  });

  it("returns false on query error (fail closed)", async () => {
    mockFrom.mockReturnValue(
      makeCountChain(null, { code: "PGRST000", message: "connection refused" }),
    );
    const result = await isActiveThread("C_OPS", "1234.5678", mockClient);
    expect(result).toBe(false);
  });
});

describe("getRequest", () => {
  it("returns the row when found", async () => {
    const row = makeDbRow();
    const chain = chainableQuery(row);
    mockFrom.mockReturnValue(chain);

    const result = await getRequest("req-1", mockClient);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("req-1");
  });

  it("returns null when not found", async () => {
    const chain = chainableQuery(null);
    mockFrom.mockReturnValue(chain);

    const result = await getRequest("missing", mockClient);
    expect(result).toBeNull();
  });
});
