import { describe, expect, it, vi } from "vitest";
import {
  evaluateGuards,
  isReadonlySelect,
  parseOperators,
} from "../guards";

// ---------------------------------------------------------------------------
// Test 5: parse_operators_accepts_id_email_pairs
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Test 1: kill_switch_off_refuses_before_anything
// ---------------------------------------------------------------------------

describe("evaluateGuards", () => {
  const baseEnv = {
    OPS_AGENT: "on",
    OPS_AGENT_OPERATORS: "U1:a@x.com,U2:b@x.com",
    OPS_AGENT_CHANNEL_ID: "C_OPS",
  };

  it("refuses when kill switch is off", () => {
    const result = evaluateGuards({
      env: { ...baseEnv, OPS_AGENT: "off" },
      slackUserId: "U1",
      channelId: "C_OPS",
    });
    expect(result).toEqual({ ok: false, reason: "off" });
  });

  it("refuses when OPS_AGENT is missing", () => {
    const result = evaluateGuards({
      env: { OPS_AGENT_OPERATORS: "U1:a@x.com", OPS_AGENT_CHANNEL_ID: "C_OPS" },
      slackUserId: "U1",
      channelId: "C_OPS",
    });
    expect(result).toEqual({ ok: false, reason: "off" });
  });

  // ---------------------------------------------------------------------------
  // Test 2: unknown_slack_user_is_refused
  // ---------------------------------------------------------------------------

  it("refuses unknown slack user", () => {
    const result = evaluateGuards({
      env: baseEnv,
      slackUserId: "U_UNKNOWN",
      channelId: "C_OPS",
    });
    expect(result).toEqual({ ok: false, reason: "not_operator" });
  });

  it("returns operatorEmail for a known user", () => {
    const result = evaluateGuards({
      env: baseEnv,
      slackUserId: "U1",
      channelId: "C_OPS",
    });
    expect(result).toEqual({ ok: true, operatorEmail: "a@x.com" });
  });

  // ---------------------------------------------------------------------------
  // Test 3: wrong_channel_is_refused
  // ---------------------------------------------------------------------------

  it("refuses wrong channel", () => {
    const result = evaluateGuards({
      env: baseEnv,
      slackUserId: "U1",
      channelId: "C_WRONG",
    });
    expect(result).toEqual({ ok: false, reason: "wrong_channel" });
  });
});

// ---------------------------------------------------------------------------
// Test 6: sql_guard_rejects_non_select_and_multi_statement
// ---------------------------------------------------------------------------

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
    // The semicolon is inside a comment, not in executable SQL
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
