import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `railway.json` is read by BOTH Railway environments, and `environments.<name>`
 * merges over the base block rather than replacing it. So anything left at the
 * base level runs in production the moment `staging` is promoted — which is how
 * `preDeployCommand` became a production-deploy hazard (DEV-1491).
 *
 * `pnpm db:migrate` calls `validateDeploymentTarget()`, which requires
 * FORMORIA_DEPLOYMENT_ENV, SUPABASE_PROJECT_REF and SUPABASE_DB_URL. The Railway
 * production service defines none of the three, so a base-level pre-deploy
 * command would throw before the health check and abort every production deploy.
 *
 * These assertions exist because that failure is invisible until a release: the
 * file is correct on staging, the tests are green, and the damage lands on the
 * first promotion.
 */
const config = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "..", "railway.json"), "utf8"),
) as {
  deploy?: Record<string, unknown>;
  environments?: Record<string, { deploy?: Record<string, unknown> }>;
};

describe("railway.json", () => {
  it("keeps preDeployCommand out of the base deploy block", () => {
    expect(config.deploy).toBeDefined();
    expect(config.deploy).not.toHaveProperty("preDeployCommand");
  });

  it("runs the migration only in the staging environment", () => {
    expect(config.environments?.staging?.deploy?.preDeployCommand).toEqual([
      "pnpm db:migrate",
    ]);
  });

  it("declares no production pre-deploy command until production can run one", () => {
    // Lifting this is a deliberate act, not a drive-by: provision the three
    // variables on the Railway production service first, then add the entry.
    expect(
      config.environments?.production?.deploy?.preDeployCommand,
    ).toBeUndefined();
  });

  it("keeps the health check at the base level, where every environment needs it", () => {
    expect(config.deploy?.healthcheckPath).toBe("/api/health");
  });
});
