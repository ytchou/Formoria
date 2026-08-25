import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import * as Sentry from "@sentry/nextjs";
import { reportAndReturn } from "../report";

describe("reportAndReturn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls Sentry.captureException with server-action tag", () => {
    const error = new Error("test");
    const result = { success: false as const, error: "fail" };

    reportAndReturn(error, result);

    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { layer: "server-action" },
    });
  });

  it("returns the result unchanged", () => {
    const error = new Error("test");
    const result = { success: false as const, error: "fail" };

    const returned = reportAndReturn(error, result);

    expect(returned).toBe(result);
  });
});
