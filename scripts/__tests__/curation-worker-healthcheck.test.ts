import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CURATION_WORKER_HEALTH_PATHS,
  isCurationWorkerHealthPath,
} from "../curation-worker-health-paths";

const railwayConfig = JSON.parse(
  readFileSync(resolve(process.cwd(), "railway.json"), "utf8"),
) as { deploy?: { healthcheckPath?: string } };

describe("curation worker healthcheck", () => {
  it("answers the path railway.json makes Railway probe", () => {
    // Regression (DEV-1548): railway.json's healthcheckPath applies to every
    // service in the project, so the worker must answer it too. When it did
    // not, Railway failed the deploy after 5m of "service unavailable" and
    // kept the previous container — production ran pre-cutover worker code
    // against a post-cutover schema, and the only visible symptom was a
    // non-required red check on an unrelated PR.
    const probed = railwayConfig.deploy?.healthcheckPath;

    expect(probed).toBeTruthy();
    expect(isCurationWorkerHealthPath(probed)).toBe(true);
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
