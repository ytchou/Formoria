import { describe, expect, it } from "vitest";

import type { CheckUrlResult } from "@/lib/services/link-checks/check-url";

import {
  applyRepairs,
  type CurrentRow,
  type RepairEntry,
} from "../repair-dead-links";

const OLD = "https://www.nui.com.tw/products/luna-leaf";
const NEW = "https://www.nui.com.tw/products/luna";

function entry(overrides: Partial<RepairEntry> = {}): RepairEntry {
  return {
    id: "p1",
    key: "luna",
    brandSlug: "nui",
    nameZh: "交叉開岔秒乾長袖 Luna",
    oldUrl: OLD,
    proposal: "replace",
    newUrl: NEW,
    evidence: "h1 names Luna, HTTP 200",
    review: "approved",
    ...overrides,
  };
}

function rows(...list: CurrentRow[]): Map<string, CurrentRow> {
  return new Map(list.map((row) => [row.id, row]));
}

const live = (id = "p1"): CurrentRow => ({ id, visible: true, official_url: OLD });
const ok: CheckUrlResult = { status: "ok", statusCode: 200, resolvedUrl: NEW };

function recorder() {
  const calls: string[] = [];
  return {
    calls,
    probe: async () => ok,
    replaceUrl: async (id: string, url: string) => {
      calls.push(`replace ${id} ${url}`);
    },
    retire: async (id: string) => {
      calls.push(`retire ${id}`);
    },
  };
}

describe("applyRepairs", () => {
  it("writes approved replace and retire entries through the service seams", async () => {
    const r = recorder();
    const report = await applyRepairs({
      entries: [entry(), entry({ id: "p2", proposal: "retire", newUrl: null })],
      current: rows(live(), live("p2")),
      apply: true,
      ...r,
    });

    expect(r.calls).toEqual([`replace p1 ${NEW}`, "retire p2"]);
    expect(report).toMatchObject({ intended: 2, written: 2, writtenBrandSlugs: ["nui"] });
  });

  it("writes nothing on a dry run", async () => {
    const r = recorder();
    const report = await applyRepairs({
      entries: [entry()],
      current: rows(live()),
      apply: false,
      ...r,
    });

    expect(r.calls).toEqual([]);
    expect(report).toMatchObject({ intended: 1, written: 0 });
  });

  it("skips entries a person has not approved, and every unresolved one", async () => {
    const r = recorder();
    const report = await applyRepairs({
      entries: [
        entry({ review: "pending" }),
        entry({ id: "p2", review: "rejected" }),
        entry({ id: "p3", proposal: "unresolved", newUrl: null }),
        entry({ id: "p4", newUrl: "not a url" }),
      ],
      current: rows(live(), live("p2"), live("p3"), live("p4")),
      apply: true,
      ...r,
    });

    expect(r.calls).toEqual([]);
    expect(report.skipped).toMatchObject({
      "not-approved": 2,
      unresolved: 1,
      "no-new-url": 1,
    });
  });

  it("lets a curator edit made since the manifest win", async () => {
    const r = recorder();
    const report = await applyRepairs({
      entries: [entry(), entry({ id: "p2" }), entry({ id: "p3" })],
      current: rows(
        { id: "p1", visible: true, official_url: "https://www.nui.com.tw/products/luna-v2" },
        { id: "p2", visible: false, official_url: OLD },
      ),
      apply: true,
      ...r,
    });

    expect(r.calls).toEqual([]);
    expect(report.skipped).toMatchObject({
      "url-changed": 1,
      "row-hidden": 1,
      "row-missing": 1,
    });
  });

  it("skips a replacement that does not answer ok now", async () => {
    const r = recorder();
    const report = await applyRepairs({
      entries: [entry()],
      current: rows(live()),
      apply: true,
      ...r,
      probe: async () => ({ status: "broken", statusCode: 404, resolvedUrl: null }),
    });

    expect(r.calls).toEqual([]);
    expect(report.skipped["new-url-not-ok"]).toBe(1);
  });

  it("carries a failed write and keeps going", async () => {
    const r = recorder();
    const report = await applyRepairs({
      entries: [entry(), entry({ id: "p2", proposal: "retire", newUrl: null })],
      current: rows(live(), live("p2")),
      apply: true,
      ...r,
      replaceUrl: async () => {
        throw new Error("boom");
      },
    });

    expect(r.calls).toEqual(["retire p2"]);
    expect(report.failures).toEqual(["p1: boom"]);
    expect(report.written).toBe(1);
  });
});
