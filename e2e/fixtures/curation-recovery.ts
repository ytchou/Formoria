import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  validateStagingTarget,
  projectRefFromDatabaseUrl,
} from "../../src/lib/supabase/project-target";

/** Runs against real staging Postgres; the connection always rolls back its fixtures and DDL. */
export function verifyAtomicRecovery(
  options: { installMigration?: boolean } = {},
): unknown {
  const target = validateStagingTarget();
  const databaseUrl = process.env.SUPABASE_DB_URL;
  if (
    !databaseUrl ||
    projectRefFromDatabaseUrl(databaseUrl) !== target.projectRef
  ) {
    throw new Error(
      "Recovery fixture requires the validated staging database connection",
    );
  }
  const migration =
    options.installMigration === false
      ? ""
      : readFileSync(
          path.resolve(
            "supabase/migrations/20260916090000_atomic_enrichment_checkpoints.sql",
          ),
          "utf8",
        );
  const assertions = readFileSync(
    path.resolve("e2e/fixtures/curation-recovery-commit.sql"),
    "utf8",
  );
  const connection = new URL(databaseUrl);
  const result = spawnSync(
    "psql",
    [
      "--no-psqlrc",
      "--set=ON_ERROR_STOP=1",
      "--quiet",
      "--tuples-only",
      "--no-align",
    ],
    {
      env: {
        ...process.env,
        PGHOST: connection.hostname,
        PGPORT: connection.port || "5432",
        PGDATABASE: connection.pathname.slice(1),
        PGUSER: decodeURIComponent(connection.username),
        PGPASSWORD: decodeURIComponent(connection.password),
        PGSSLMODE: "require",
        PGCONNECT_TIMEOUT: "10",
      },
      input: `begin;\nset local lock_timeout = '5s';\nset local statement_timeout = '20s';\n${migration}\n${assertions}\nrollback;\n`,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `Recovery transaction verification failed: ${result.stderr}`,
    );
  return JSON.parse(result.stdout.trim()) as unknown;
}
