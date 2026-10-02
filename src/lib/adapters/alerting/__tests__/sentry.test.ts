import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  getClient: vi.fn(),
  flush: vi.fn(),
}));
vi.mock("@sentry/node", () => sentry);

import { flushAlerts } from "../sentry";

beforeEach(() => {
  sentry.getClient.mockReset();
  sentry.flush.mockReset();
});

describe("flushAlerts", () => {
  it("flushAlerts_resolves_true_when_no_client", async () => {
    sentry.getClient.mockReturnValue(undefined);

    await expect(flushAlerts()).resolves.toBe(true);
    expect(sentry.flush).not.toHaveBeenCalled();
  });

  it("flushAlerts_passes_the_timeout_to_sentry", async () => {
    sentry.getClient.mockReturnValue({});
    sentry.flush.mockResolvedValue(true);

    await expect(flushAlerts(1_500)).resolves.toBe(true);
    expect(sentry.flush).toHaveBeenCalledWith(1_500);
  });

  it("flushAlerts_defaults_to_a_2s_timeout", async () => {
    sentry.getClient.mockReturnValue({});
    sentry.flush.mockResolvedValue(true);

    await flushAlerts();
    expect(sentry.flush).toHaveBeenCalledWith(2_000);
  });

  it("flushAlerts_never_throws_on_flush_failure", async () => {
    sentry.getClient.mockReturnValue({});
    sentry.flush.mockRejectedValue(new Error("transport down"));

    await expect(flushAlerts()).resolves.toBe(false);
  });

  // DEV-1920: under ESM `getClient` was undefined, so calling it threw.
  it("flushAlerts_never_throws_when_getClient_throws", async () => {
    sentry.getClient.mockImplementation(() => {
      throw new TypeError("Sentry.getClient is not a function");
    });

    await expect(flushAlerts()).resolves.toBe(false);
  });
});

describe("sentry package versions", () => {
  // The adapter imports @sentry/node while Next initializes through
  // @sentry/nextjs. The client is stored per SDK version, so a version split
  // makes the adapter miss Next's client and init a second, unscrubbed one.
  it("pins @sentry/node to the version @sentry/nextjs depends on", () => {
    const root = path.join(process.cwd(), "node_modules", "@sentry");
    const read = (pkg: string) =>
      JSON.parse(readFileSync(path.join(root, pkg, "package.json"), "utf8"));

    expect(read("node").version).toBe(
      read("nextjs").dependencies["@sentry/node"],
    );
  });
});
