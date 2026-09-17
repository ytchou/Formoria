import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function runDoctorWithMigrationOutput(output: string) {
  const directory = mkdtempSync(join(tmpdir(), "formoria-doctor-"));
  const supabase = join(directory, "supabase");
  writeFileSync(
    supabase,
    `#!/bin/sh\nprintf '%s\\n' '${output.replace(/'/g, "'\\''")}'\n`,
    "utf8",
  );
  chmodSync(supabase, 0o755);

  try {
    return spawnSync("bash", ["scripts/doctor.sh"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH ?? ""}`,
        SUPABASE_DB_URL:
          "postgresql://postgres:unused@db.ttkkyvgvcamfoezsetvf.supabase.co:5432/postgres",
        DATABASE_URL: "",
        HEALTH_AGENT_READ_DATABASE_URL: "",
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("doctor --health-railway mode", () => {
  function runDoctorHealthRailway(envOverrides: Record<string, string> = {}) {
    return spawnSync("bash", ["scripts/doctor.sh", "--health-railway"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        // Prevent the migration check from hitting a real DB
        SUPABASE_DB_URL: "",
        DATABASE_URL: "",
        HEALTH_AGENT_READ_DATABASE_URL: "",
        ...envOverrides,
      },
    });
  }

  it("requires REPO_WORKER_URL, HEALTH_AGENT_GITHUB_APP_ID, HEALTH_AGENT_GITHUB_APP_PRIVATE_KEY, HEALTH_AGENT_GITHUB_APP_INSTALLATION_ID, CLAUDE_CODE_OAUTH_TOKEN, PRODUCTION_BASE_URL", () => {
    const result = runDoctorHealthRailway();
    const out = result.stdout;
    expect(out).toContain("Checking health agent Railway configuration...");
    for (const v of [
      "REPO_WORKER_URL",
      "HEALTH_AGENT_GITHUB_APP_ID",
      "HEALTH_AGENT_GITHUB_APP_PRIVATE_KEY",
      "HEALTH_AGENT_GITHUB_APP_INSTALLATION_ID",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "PRODUCTION_BASE_URL",
    ]) {
      expect(out).toContain(v);
    }
    // Must not require the old reader/writer JWT vars
    expect(out).not.toContain("HEALTH_AGENT_READER_TOKEN");
    expect(out).not.toContain("HEALTH_AGENT_WRITER_TOKEN");
  });
});

describe("environment doctor migration ledger contract", () => {
  it("accepts current JSON migration output with a remote version", () => {
    const result = runDoctorWithMigrationOutput(
      '{"migrations":[{"local":"20260803033000","remote":"20260803033000"}]}',
    );

    expect(result.stdout).toContain(
      "OK: brand_ai_results phase CHECK migration applied on the explicit target",
    );
  });

  it("fails when JSON migration output omits the required remote version", () => {
    const result = runDoctorWithMigrationOutput(
      '{"migrations":[{"local":"20260803033000","remote":null}]}',
    );

    expect(result.stdout).toContain(
      "ERROR: brand_ai_results phase CHECK migration is not applied on the explicit target",
    );
    expect(result.status).not.toBe(0);
  });

  it("keeps accepting the legacy pipe-delimited migration table", () => {
    const result = runDoctorWithMigrationOutput(
      "20260803033000 | 20260803033000 | 2026-08-03",
    );

    expect(result.stdout).toContain(
      "OK: brand_ai_results phase CHECK migration applied on the explicit target",
    );
  });
});
