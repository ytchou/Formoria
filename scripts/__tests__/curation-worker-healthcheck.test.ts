import { describe, expect, it } from "vitest";

import {
  CURATION_WORKER_HEALTH_PATHS,
  isCurationWorkerHealthPath,
} from "../curation-worker-health-paths";

describe("curation worker healthcheck", () => {
  it("answers the path Railway probes", () => {
    // Regression (DEV-1548): railway.json's healthcheckPath applies to every
    // service in the project, so the worker must answer it too.
    expect(isCurationWorkerHealthPath("/api/health")).toBe(true);
  });

  it("keeps answering its own /health path", () => {
    expect(isCurationWorkerHealthPath("/health")).toBe(true);
  });

  it("does not treat unrelated paths as health checks", () => {
    for (const path of ["/run", "/", "/healthz", "/api/health/", undefined]) {
      expect(isCurationWorkerHealthPath(path)).toBe(false);
    }
  });

  it("exposes every served health path", () => {
    for (const path of CURATION_WORKER_HEALTH_PATHS) {
      expect(isCurationWorkerHealthPath(path)).toBe(true);
    }
  });
});
