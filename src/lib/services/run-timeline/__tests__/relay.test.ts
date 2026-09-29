import { afterEach, describe, expect, it, vi } from "vitest";
import { applyRoutineTimelineEvent, type RoutineTimelineDeps } from "../relay";

const REF = { channel: "C0ALERTS", ts: "1727200000.000100" };
const NOW = 1_727_200_500;

function makeDeps(overrides: Partial<RoutineTimelineDeps> = {}) {
  return {
    appendRunEvent: vi.fn<RoutineTimelineDeps["appendRunEvent"]>(async () => true),
    recordTickets: vi.fn<RoutineTimelineDeps["recordTickets"]>(async (links) => links.length),
    now: () => NOW,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("applyRoutineTimelineEvent — kind allowlist", () => {
  it.each(["started", "repair_started", "findings", "repair_requested", "bogus"])(
    "rejects kind %s without appending",
    async (kind) => {
      const deps = makeDeps();
      const result = await applyRoutineTimelineEvent(
        { ...REF, event: { kind, at: 1, sessionUrl: "https://claude.ai/code/session_01HqK7xZ3mP9" } },
        deps,
      );
      expect(result.ok).toBe(false);
      expect(deps.appendRunEvent).not.toHaveBeenCalled();
    },
  );

  it("rejects a malformed payload for an allowed kind", async () => {
    const deps = makeDeps();
    const result = await applyRoutineTimelineEvent(
      { ...REF, event: { kind: "pr_opened", number: "12", url: "https://github.com/ytchou/Formoria/pull/1252" } },
      deps,
    );
    expect(result.ok).toBe(false);
    expect(deps.appendRunEvent).not.toHaveBeenCalled();
  });

  it("rejects a missing timeline ref", async () => {
    const deps = makeDeps();
    const result = await applyRoutineTimelineEvent({ event: { kind: "completed" } }, deps);
    expect(result.ok).toBe(false);
  });
});

describe("applyRoutineTimelineEvent — append", () => {
  it("appends completed with a server-set timestamp", async () => {
    const deps = makeDeps();
    const result = await applyRoutineTimelineEvent({ ...REF, event: { kind: "completed" } }, deps);
    expect(result).toEqual({ ok: true, appended: true, recorded: 0 });
    expect(deps.appendRunEvent).toHaveBeenCalledWith(REF, { kind: "completed", at: NOW });
    expect(deps.recordTickets).not.toHaveBeenCalled();
  });

  it("keeps a caller-supplied timestamp and appends failed", async () => {
    const deps = makeDeps();
    await applyRoutineTimelineEvent(
      { ...REF, event: { kind: "failed", at: 42, outcome: "gave_up", reason: "no repro" } },
      deps,
    );
    expect(deps.appendRunEvent).toHaveBeenCalledWith(REF, {
      kind: "failed",
      at: 42,
      outcome: "gave_up",
      reason: "no repro",
    });
  });

  it("strips relay-only fingerprints from pr_opened before appending", async () => {
    const deps = makeDeps();
    await applyRoutineTimelineEvent(
      {
        ...REF,
        event: {
          kind: "pr_opened",
          number: 1260,
          url: "https://github.com/ytchou/formoria/pull/1260",
          title: "fix(DEV-1870): guard empty brand list",
          ticketId: "DEV-1870",
          fingerprints: ["fp-a"],
        },
      },
      deps,
    );
    expect(deps.appendRunEvent).toHaveBeenCalledWith(REF, {
      kind: "pr_opened",
      at: NOW,
      number: 1260,
      url: "https://github.com/ytchou/formoria/pull/1260",
      title: "fix(DEV-1870): guard empty brand list",
      ticketId: "DEV-1870",
    });
  });

  it("strips relay-only fingerprints from every filed ticket before appending", async () => {
    const deps = makeDeps();
    await applyRoutineTimelineEvent(
      {
        ...REF,
        event: {
          kind: "tickets_filed",
          tickets: [
            {
              id: "DEV-2041",
              url: "https://linear.app/ytchou/issue/DEV-2041",
              title: "Resend domain unverified",
              fingerprints: ["resend-domain:formoria.com", "resend-domain:mail.formoria.com"],
            },
          ],
        },
      },
      deps,
    );
    expect(deps.appendRunEvent).toHaveBeenCalledWith(REF, {
      kind: "tickets_filed",
      at: NOW,
      tickets: [
        {
          id: "DEV-2041",
          url: "https://linear.app/ytchou/issue/DEV-2041",
          title: "Resend domain unverified",
        },
      ],
    });
    expect(deps.recordTickets).toHaveBeenCalledWith([
      { fingerprint: "resend-domain:formoria.com", identifier: "DEV-2041" },
      { fingerprint: "resend-domain:mail.formoria.com", identifier: "DEV-2041" },
    ]);
  });

  it("reports appended: false when the timeline append fails", async () => {
    const deps = makeDeps({ appendRunEvent: vi.fn(async () => false) });
    const result = await applyRoutineTimelineEvent({ ...REF, event: { kind: "completed" } }, deps);
    expect(result).toEqual({ ok: true, appended: false, recorded: 0 });
  });
});

describe("applyRoutineTimelineEvent — ticket write-back", () => {
  it("maps every fingerprint of every filed ticket to its identifier", async () => {
    const deps = makeDeps();
    const result = await applyRoutineTimelineEvent(
      {
        ...REF,
        event: {
          kind: "tickets_filed",
          tickets: [
            {
              id: "DEV-1871",
              url: "https://linear.app/formoria/issue/DEV-1871",
              title: "Resend domain unverified",
              fingerprints: ["fp-a", "fp-b"],
            },
            {
              id: "DEV-1872",
              url: "https://linear.app/formoria/issue/DEV-1872",
              title: "Sentry capture gap",
              fingerprints: ["fp-c"],
            },
            {
              id: "DEV-1873",
              url: "https://linear.app/formoria/issue/DEV-1873",
              title: "No fingerprints",
            },
          ],
        },
      },
      deps,
    );
    expect(deps.recordTickets).toHaveBeenCalledWith([
      { fingerprint: "fp-a", identifier: "DEV-1871" },
      { fingerprint: "fp-b", identifier: "DEV-1871" },
      { fingerprint: "fp-c", identifier: "DEV-1872" },
    ]);
    expect(result).toEqual({ ok: true, appended: true, recorded: 3 });
  });

  it("maps pr_opened fingerprints to the PR ticket", async () => {
    const deps = makeDeps();
    await applyRoutineTimelineEvent(
      {
        ...REF,
        event: {
          kind: "pr_opened",
          number: 7,
          url: "https://github.com/ytchou/formoria/pull/7",
          title: "fix(DEV-1874): retry Resend domain check",
          ticketId: "DEV-1874",
          fingerprints: ["fp-z"],
        },
      },
      deps,
    );
    expect(deps.recordTickets).toHaveBeenCalledWith([
      { fingerprint: "fp-z", identifier: "DEV-1874" },
    ]);
  });

  it("skips the write-back when pr_opened has no ticketId", async () => {
    const deps = makeDeps();
    await applyRoutineTimelineEvent(
      {
        ...REF,
        event: {
          kind: "pr_opened",
          number: 7,
          url: "https://github.com/ytchou/formoria/pull/7",
          title: "fix(e2e): update brand card selector",
          fingerprints: ["fp-z"],
        },
      },
      deps,
    );
    expect(deps.recordTickets).not.toHaveBeenCalled();
  });

  it("tolerates a recordTickets failure without failing the append", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps({
      recordTickets: vi.fn(async () => {
        throw new Error("connection reset");
      }),
    });
    const result = await applyRoutineTimelineEvent(
      {
        ...REF,
        event: {
          kind: "tickets_filed",
          tickets: [
            {
              id: "DEV-1871",
              url: "https://linear.app/formoria/issue/DEV-1871",
              title: "Resend domain unverified",
              fingerprints: ["fp-a"],
            },
          ],
        },
      },
      deps,
    );
    expect(deps.appendRunEvent).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      appended: true,
      recorded: 0,
      recordError: "connection reset",
    });
  });
});
