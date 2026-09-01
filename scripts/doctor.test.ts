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
