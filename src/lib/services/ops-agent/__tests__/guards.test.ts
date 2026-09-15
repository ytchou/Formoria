import { describe, expect, it, vi } from "vitest";
import {
  evaluateGuards,
  isReadonlySelect,
  parseOperators,
} from "../guards";

describe("parseOperators", () => {
  it("parses id:email pairs separated by commas", () => {
    const map = parseOperators("U1:a@x.com,U2:b@x.com");
    expect(map.size).toBe(2);
    expect(map.get("U1")).toBe("a@x.com");
    expect(map.get("U2")).toBe("b@x.com");
  });

  it("drops malformed entries with a console warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const map = parseOperators("U1:a@x.com,bad-entry,U3:c@x.com,:no-id,no-email:");
    expect(map.size).toBe(2);
    expect(map.get("U1")).toBe("a@x.com");
    expect(map.get("U3")).toBe("c@x.com");
    expect(warnSpy).toHaveBeenCalledTimes(3);

    warnSpy.mockRestore();
  });

  it("handles empty string", () => {
    expect(parseOperators("").size).toBe(0);
    expect(parseOperators("  ").size).toBe(0);
  });
});

describe("evaluateGuards", () => {
  const baseEnv = {
    OPS_AGENT: "on",
    OPS_AGENT_OPERATORS: "U1:a@x.com,U2:b@x.com",
  };

  it("refuses when kill switch is off", () => {
    const result = evaluateGuards({
      env: { ...baseEnv, OPS_AGENT: "off" },
      slackUserId: "U1",
      channelName: "formoria-ops",
    });
    expect(result).toEqual({ ok: false, reason: "off" });
  });

  it("refuses when OPS_AGENT is missing", () => {
    const result = evaluateGuards({
      env: { OPS_AGENT_OPERATORS: "U1:a@x.com" },
      slackUserId: "U1",
      channelName: "formoria-ops",
    });
    expect(result).toEqual({ ok: false, reason: "off" });
  });

  it("refuses unknown slack user", () => {
    const result = evaluateGuards({
      env: baseEnv,
      slackUserId: "U_UNKNOWN",
      channelName: "formoria-ops",
    });
    expect(result).toEqual({ ok: false, reason: "not_operator" });
  });

  it("allows formoria-prefixed channels", () => {
    const result = evaluateGuards({
      env: baseEnv,
      slackUserId: "U1",
      channelName: "formoria-ops",
    });
    expect(result).toEqual({ ok: true, operatorEmail: "a@x.com" });
  });

  it("allows any formoria- channel name", () => {
    for (const name of ["formoria-agent-alerts", "formoria-dev", "formoria-test"]) {
      const result = evaluateGuards({
        env: baseEnv,
        slackUserId: "U2",
        channelName: name,
      });
      expect(result).toEqual({ ok: true, operatorEmail: "b@x.com" });
    }
  });

  it("refuses channels not starting with formoria-", () => {
    const result = evaluateGuards({
      env: baseEnv,
      slackUserId: "U1",
      channelName: "general",
    });
    expect(result).toEqual({ ok: false, reason: "wrong_channel" });
  });

  it("refuses when channel name is null (resolution failed)", () => {
    const result = evaluateGuards({
      env: baseEnv,
      slackUserId: "U1",
      channelName: null,
    });
    expect(result).toEqual({ ok: false, reason: "wrong_channel" });
  });
});

describe("isReadonlySelect", () => {
  it("accepts a plain select", () => {
    expect(isReadonlySelect("SELECT 1")).toBe(true);
    expect(isReadonlySelect("  select count(*) from brands")).toBe(true);
  });

  it("rejects non-select statements", () => {
    expect(isReadonlySelect("INSERT INTO x VALUES (1)")).toBe(false);
    expect(isReadonlySelect("UPDATE x SET a = 1")).toBe(false);
    expect(isReadonlySelect("DELETE FROM x")).toBe(false);
    expect(isReadonlySelect("DROP TABLE x")).toBe(false);
  });

  it("rejects multi-statement queries (semicolon)", () => {
    expect(isReadonlySelect("select 1; drop table x")).toBe(false);
  });

  it("allows select with line comments that contain semicolons", () => {
    expect(isReadonlySelect("select 1 -- ; comment")).toBe(true);
  });

  it("rejects queries exceeding 4000 characters", () => {
    const longSelect = "select " + "a".repeat(4000);
    expect(isReadonlySelect(longSelect)).toBe(false);
  });

  it("handles case-insensitive SELECT", () => {
    expect(isReadonlySelect("SELECT 1")).toBe(true);
    expect(isReadonlySelect("Select 1")).toBe(true);
    expect(isReadonlySelect("sElEcT 1")).toBe(true);
  });
});
